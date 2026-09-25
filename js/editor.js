// ============================================================
// 編集画面：台紙の表示と指の操作
// （内部では「窓」だが、画面上はすべて「写真」と呼ぶ）
// 編集の対象は常に選択中の1枚だけ。他の写真には影響しない。
//
// 写真（「文字」以外のツールのとき）
//  ・タップ          … 写真を選ぶ（プールの写真を持っていれば差し替え）
//  ・1本指ドラッグ   … 写真を移動（枠ごと）
//  ・ピンチ          … 枠と中身をまとめて等倍で拡大縮小
//  ・四隅のつまみ    … 同上（縦横比を保つ）
//  ・辺の中央のつまみ … 枠だけ変える（中の写真はその場に残る＝切り取り方を変える）
//  ・つまみ／写真を長押し→ドラッグ … 中の写真だけ動かす
// 文字（「文字」ツールのとき）
//  ・文字だけを触れる。ドラッグで移動、左右のつまみで幅を変える
// 吸着：コマの端には常に、グリッド表示中はグリッド線にも吸着する。重なりの制限はない
// ============================================================

const editor = {
  canvas: null, ctx: null,
  dirty: false,
  pxPerUnit: 1,     // 台紙1pxあたりのcanvas画素
  pointers: new Map(),
  gesture: null,
  ghost: null,      // 中の写真だけ動かしている写真（枠外を薄く見せる）
  pressTimer: 0,
  x0: 0,            // 表示の左端（台紙px）
  visW: 1,          // 表示している幅（台紙px）

  init() {
    this.canvas = $('board');
    this.ctx = this.canvas.getContext('2d');
    window.addEventListener('resize', () => this.resize());
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.onDown(e));
    c.addEventListener('pointermove', e => this.onMove(e));
    c.addEventListener('pointerup', e => this.onUp(e));
    c.addEventListener('pointercancel', e => this.onUp(e, true));
    c.addEventListener('contextmenu', e => e.preventDefault());
    // iOSのページ拡大ジェスチャを抑止
    document.addEventListener('gesturestart', e => e.preventDefault());
  },

  // 表示範囲：選択中のコマを中心に、両隣が少し見える幅（1.2コマ分）
  resize() {
    if (!state.post) return;
    const b = boardSize(state.post.n), FW = CONFIG.GRID.FRAME_W;
    this.visW = Math.min(b.w, FW * 1.2);
    this.x0 = clamp((state.frame + 0.5) * FW - this.visW / 2, 0, b.w - this.visW);
    const wrap = this.canvas.parentElement;
    // 横幅いっぱい。ただしツールボックスの場所を残すため、高さは画面の約半分まで
    const maxH = Math.max(240, window.innerHeight * CONFIG.EDIT.BOARD_MAX_H);
    const cssW = Math.min(wrap.clientWidth, maxH * this.visW / b.h);
    const cssH = cssW * b.h / this.visW;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.pxPerUnit = this.canvas.width / this.visW;
    this.requestDraw();
  },

  requestDraw() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => { this.dirty = false; this.draw(); });
  },

  draw() {
    const ctx = this.ctx, k = this.pxPerUnit;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, -this.x0 * k, 0);
    drawPost(ctx, state.post, state.photos);
    const gw = this.ghost, textTool = state.tool === 'text';
    drawGuides(ctx, state.post, {
      frame: state.frame,
      selected: state.selected,
      grid: state.grid,
      handles: textTool ? 'lr' : !gw,
      ghost: gw && state.photos[gw.photo] ? { win: gw, photo: state.photos[gw.photo] } : null,
    }, this.unitsPerCss());
  },

  // ---------- 座標 ----------

  unitsPerCss() {
    return this.visW / this.canvas.getBoundingClientRect().width;
  },

  toBoard(e) {
    const r = this.canvas.getBoundingClientRect();
    const u = this.unitsPerCss();
    return { x: this.x0 + (e.clientX - r.left) * u, y: (e.clientY - r.top) * u, cx: e.clientX, cy: e.clientY };
  },

  // ---------- ポインタ ----------

  onDown(e) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const p = this.toBoard(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) this.beginSingle(p);
    else this.beginMulti();
  },

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.toBoard(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    const moved = g.start && Math.hypot(p.cx - g.start.cx, p.cy - g.start.cy) > CONFIG.EDIT.TAP_SLOP;
    switch (g.type) {
      case 'pending': if (moved) { this.cancelPress(); this.promote(g, p); } break;
      case 'handle':  if (moved) { this.cancelPress(); g.type = 'resize'; this.resizePart(g, p); } break;
      case 'move':    this.movePart(g, p); break;
      case 'resize':  this.resizePart(g, p); break;
      case 'scale':   this.pinchPart(g); break;
      case 'pan':     this.panPhoto(g); break;
    }
  },

  onUp(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.cancelPress();
    const g = this.gesture;
    if (this.pointers.size > 0) {
      // 2本指から1本指に戻ったら、指を離すまで何もしない
      if (g && g.type === 'scale') this.gesture = { type: 'idle' };
      return;
    }
    this.gesture = null;
    this.ghost = null;
    if (!g || cancelled) { this.requestDraw(); return; }
    if (g.type === 'pending') this.tap(g.start);
    else onEditChanged();
  },

  beginSingle(p) {
    const sel = state.selected;
    if (sel && state.poolPick == null) {
      const only = sel.type === 'text' ? [6, 7] : null;
      const h = this.handleAt(sel, p, only);
      if (h >= 0) {
        this.gesture = { type: 'handle', h, start: p, ...this.snapshot(sel) };
        this.armPress();
        return;
      }
    }
    const hit = this.hitAt(p);
    this.gesture = { type: 'pending', start: p, hit };
    if (hit && hit === sel) this.armPress();
  },

  beginMulti() {
    this.cancelPress();
    const g = this.gesture;
    if (g && g.type === 'pending' && g.hit) select(g.hit, g.start);
    const sel = state.selected;
    this.gesture = sel && sel.type !== 'text'
      ? { type: 'scale', m: this.centroid(), d: Math.max(1, this.spread()), ...this.snapshot(sel) }
      : { type: 'idle' };
    this.requestDraw();
  },

  // 操作開始時の状態（拡大縮小・切り取りの基準）
  snapshot(part) {
    return { rect: partRect(part), inner: innerRect(part), zoom: part.zoom, ox: part.offsetX, oy: part.offsetY };
  },

  // 「文字」ツールでは文字だけ、それ以外では写真（とベタ）だけを拾う
  hitAt(p) {
    const parts = state.post.parts;
    if (state.tool === 'text') return partAt(parts, p.x, p.y, 'text');
    return partAt(parts, p.x, p.y, q => q.type !== 'text');
  },

  // タップ扱いの範囲を超えて動いた：選んで移動する
  promote(g, p) {
    if (state.poolPick != null || !g.hit) { this.gesture = { type: 'idle' }; return; }
    select(g.hit, g.start);
    this.gesture = { type: 'move', start: g.start, rect: partRect(g.hit) };
    this.onMove({ pointerId: [...this.pointers.keys()][0], clientX: p.cx, clientY: p.cy });
  },

  tap(p) {
    const hit = this.hitAt(p);
    const prev = state.frame;
    if (state.poolPick != null && hit && hit.type === 'window') putPhoto(hit, state.poolPick);
    select(hit, p);
    // 隣のコマをタップしたら、そのコマを中心に
    if (state.frame !== prev) this.resize();
  },

  // ---------- 長押し：中の写真だけ動かす ----------

  armPress() {
    this.cancelPress();
    const sel = state.selected;
    if (!sel || sel.type !== 'window') return;
    this.pressTimer = setTimeout(() => {
      this.pressTimer = 0;
      const g = this.gesture;
      if (!g || (g.type !== 'handle' && g.type !== 'pending') || this.pointers.size !== 1) return;
      const m = this.centroid();
      this.gesture = { type: 'pan', m, ox: sel.offsetX, oy: sel.offsetY };
      this.ghost = sel;
      if (navigator.vibrate) navigator.vibrate(10);
      this.requestDraw();
    }, CONFIG.EDIT.LONG_PRESS_MS);
  },

  cancelPress() {
    if (this.pressTimer) { clearTimeout(this.pressTimer); this.pressTimer = 0; }
  },

  panPhoto(g) {
    const win = state.selected;
    const photo = win && state.photos[win.photo];
    if (!photo) return;
    const m = this.centroid();
    win.offsetX = g.ox + (m.x - g.m.x);
    win.offsetY = g.oy + (m.y - g.m.y);
    clampWindow(win, photo);
    this.requestDraw();
  },

  // ---------- 移動 ----------

  movePart(g, p) {
    const part = state.selected;
    if (!part) return;
    const r = { ...g.rect, x: g.rect.x + p.x - g.start.x, y: g.rect.y + p.y - g.start.y };
    part.free = part.type === 'text' ? { ...part.free, ...this.snapMove(r) } : this.snapMove(r);
    part.cassette = null;
    this.afterReshape(part);
  },

  // ---------- 拡大縮小（枠と中身をまとめて等倍） ----------

  scaleTo(part, g, r) {
    part.free = roundRect(r);
    part.cassette = null;
    if (part.type === 'window') {
      const s = r.w / g.rect.w;
      part.zoom = g.zoom;
      part.offsetX = g.ox * s;
      part.offsetY = g.oy * s;
    }
    this.afterReshape(part);
  },

  pinchPart(g) {
    const part = state.selected;
    if (!part) return;
    const min = CONFIG.EDIT.MIN_FREE_SIZE, r0 = g.rect;
    const s = Math.max(this.spread() / g.d, min / Math.min(r0.w, r0.h));
    const m = this.centroid();
    this.scaleTo(part, g, { x: m.x + (r0.x - g.m.x) * s, y: m.y + (r0.y - g.m.y) * s, w: r0.w * s, h: r0.h * s });
  },

  // h: 0〜3 四隅（等倍の拡大縮小）、4〜7 辺の中央（上・下・左・右。切り取り方を変える）
  resizePart(g, p) {
    const part = state.selected;
    if (!part) return;
    const min = CONFIG.EDIT.MIN_FREE_SIZE;
    const r0 = g.rect, R0 = r0.x + r0.w, B0 = r0.y + r0.h;
    if (part.type === 'text') {
      // 文字は幅だけ。高さは中身から決まる
      let l = r0.x, rt = R0;
      if (g.h === 6) l = Math.min(p.x, rt - min * 2);
      if (g.h === 7) rt = Math.max(p.x, l + min * 2);
      const r = this.snapEdges({ x: l, y: r0.y, w: rt - l, h: r0.h }, g.h === 6 ? 'l' : 'r');
      part.free = { ...part.free, ...roundRect(r) };
      this.requestDraw();
      return;
    }
    if (g.h < 4) {
      const left = g.h === 0 || g.h === 2, top = g.h < 2;
      const ax = left ? R0 : r0.x, ay = top ? B0 : r0.y; // 対角が動かない点
      const ratio = r0.w / r0.h;
      const sx = (left ? ax - p.x : p.x - ax) / r0.w;
      const sy = (top ? ay - p.y : p.y - ay) / r0.h;
      const s = Math.max(sx, sy, min / Math.min(r0.w, r0.h));
      let w = r0.w * s, h = r0.h * s;
      // 吸着は横か縦の一方だけ。もう一方は比率から決める（比率を崩さない）
      const { xs, ys } = this.snapLines();
      const ex = this.nearest(left ? ax - w : ax + w, xs);
      const ey = this.nearest(top ? ay - h : ay + h, ys);
      if (ex != null) { w = Math.abs(ex - ax); h = w / ratio; }
      else if (ey != null) { h = Math.abs(ey - ay); w = h * ratio; }
      if (w < min || h < min) { w = r0.w * s; h = r0.h * s; }
      this.scaleTo(part, g, { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h });
      return;
    }
    let l = r0.x, t = r0.y, rt = R0, b = B0;
    if (g.h === 4) t = Math.min(p.y, b - min);
    if (g.h === 5) b = Math.max(p.y, t + min);
    if (g.h === 6) l = Math.min(p.x, rt - min);
    if (g.h === 7) rt = Math.max(p.x, l + min);
    const r = this.snapEdges({ x: l, y: t, w: rt - l, h: b - t }, ['', '', '', '', 't', 'b', 'l', 'r'][g.h]);
    this.cropTo(part, g, r);
  },

  // 枠だけ変える。中の写真は画面上の同じ位置・大きさに残す
  // （枠が写真より大きくなるときだけ、覆えるところまで写真を大きくする）
  cropTo(part, g, r) {
    part.free = roundRect(r);
    part.cassette = null;
    const photo = part.type === 'window' && state.photos[part.photo];
    if (photo) {
      const inner0 = g.inner, inner1 = innerRect(part);
      const absScale = coverScale(expandRect(inner0, CONFIG.BLEED), photo) * g.zoom;
      const cx = inner0.x + inner0.w / 2 + g.ox, cy = inner0.y + inner0.h / 2 + g.oy; // 写真の中心
      part.zoom = absScale / coverScale(expandRect(inner1, CONFIG.BLEED), photo);
      part.offsetX = cx - (inner1.x + inner1.w / 2);
      part.offsetY = cy - (inner1.y + inner1.h / 2);
    }
    this.afterReshape(part);
  },

  afterReshape(part) {
    if (part.type === 'window') {
      const photo = state.photos[part.photo];
      if (photo) clampWindow(part, photo);
    }
    this.requestDraw();
  },

  // only：調べるつまみの番号（省略時はすべて）
  handleAt(part, p, only) {
    const r = partRect(part);
    // 小さい写真でも本体をつかめるよう、当たり判定は短辺の25%まで
    const th = Math.min(CONFIG.EDIT.HANDLE_HIT * this.unitsPerCss(), Math.max(r.w, 1) * 0.25, Math.max(r.h, 40) * 0.5);
    let best = -1, bestD = th;
    handlePoints(r).forEach(([x, y], i) => {
      if (only && !only.includes(i)) return;
      const d = Math.hypot(p.x - x, p.y - y) + (i >= 4 ? th * 0.3 : 0); // 四隅を優先
      if (d < bestD) { best = i; bestD = d; }
    });
    return best;
  },

  // ---------- 吸着（コマの端は常に、グリッド線は表示中のみ） ----------

  snapLines() {
    const b = boardSize(state.post.n), FW = CONFIG.GRID.FRAME_W;
    const xs = [], ys = [0, b.h];
    if (state.grid) {
      const c = gridCell();
      // はみ出して置く写真のために、台紙の外側にも1コマ分ずつ線を延ばす
      for (let x = -FW; x <= b.w + FW + 0.1; x += c.w) xs.push(x);
      for (let y = c.h; y < b.h; y += c.h) ys.push(y);
    } else {
      for (let f = 0; f <= state.post.n; f++) xs.push(f * FW);
    }
    return { xs, ys };
  },

  nearest(v, lines) {
    const th = CONFIG.EDIT.SNAP * this.unitsPerCss();
    let best = null, bd = th;
    for (const l of lines) { const d = Math.abs(l - v); if (d <= bd) { best = l; bd = d; } }
    return best;
  },

  // 移動：左右どちらか近い辺を吸着、上下も同様。大きさは変えない
  snapMove(r) {
    const { xs, ys } = this.snapLines();
    const pick = (a, b, lines) => {
      const la = this.nearest(a, lines), lb = this.nearest(b, lines);
      const da = la == null ? Infinity : la - a, db = lb == null ? Infinity : lb - b;
      return Math.abs(da) <= Math.abs(db) ? (isFinite(da) ? da : 0) : db;
    };
    r.x += pick(r.x, r.x + r.w, xs);
    r.y += pick(r.y, r.y + r.h, ys);
    return roundRect(r);
  },

  // 動かしている辺だけ吸着
  snapEdges(r, ...edges) {
    const { xs, ys } = this.snapLines();
    let l = r.x, t = r.y, rt = r.x + r.w, b = r.y + r.h;
    for (const e of edges) {
      if (e === 'l') { const s = this.nearest(l, xs); if (s != null) l = s; }
      if (e === 'r') { const s = this.nearest(rt, xs); if (s != null) rt = s; }
      if (e === 't') { const s = this.nearest(t, ys); if (s != null) t = s; }
      if (e === 'b') { const s = this.nearest(b, ys); if (s != null) b = s; }
    }
    return { x: l, y: t, w: rt - l, h: b - t };
  },

  centroid() {
    let x = 0, y = 0;
    for (const p of this.pointers.values()) { x += p.x; y += p.y; }
    const n = this.pointers.size || 1;
    return { x: x / n, y: y / n };
  },

  spread() {
    const [a, b] = Array.from(this.pointers.values());
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
  },
};

// 矩形は0.5px単位に丸める（グリッド67.5pxに乗り、書き出し2倍で整数画素になる）
function roundRect(r) {
  const q = v => Math.round(v * 2) / 2;
  const x = q(r.x), y = q(r.y);
  return { x, y, w: q(r.x + r.w) - x, h: q(r.y + r.h) - y };
}
