// ============================================================
// 編集画面：台紙の表示と指の操作
// （内部では「窓」だが、画面上はすべて「写真」と呼ぶ）
//
// 共通
//  ・タップ          … コマと部品（写真・ベタ）を選択
//  ・プールの写真を選んだ状態で写真をタップ … 差し替え
// 自由設計
//  ・1本指ドラッグ   … 写真を移動（枠ごと。コマの端・マス目に吸着）
//  ・ピンチ          … 枠と中身をまとめて等倍で拡大縮小
//  ・四隅のつまみ    … 同上（縦横比を保つ）
//  ・辺の中央のつまみ … 枠だけ変える（中の写真はその場に残る＝切り取り方を変える）
//  ・つまみ／写真を長押し→ドラッグ … 中の写真だけ動かす（拡大表示のとき）
//  ・何もない所をドラッグ … 新しい写真を置く
// マス設計
//  ・写真をドラッグ  … 中の写真を動かす（枠はマスに固定）
//  ・ピンチ          … 中の写真を拡大縮小
//  ・空いたマスをなぞる … その範囲に新しい写真
// 文字入れ（state.stage === 'text'）
//  ・文字だけを触れる。ドラッグで移動、左右のつまみで幅を変える
// ============================================================

const editor = {
  canvas: null, ctx: null,
  dirty: false,
  pxPerUnit: 1,     // 台紙1pxあたりのcanvas画素
  pointers: new Map(),
  gesture: null,
  trace: null,      // マス設計でなぞり中 { span, ok }
  draft: null,      // 自由設計で描き中の矩形
  ghost: null,      // 中の写真だけ動かしている部品（枠外を薄く見せる）
  pressTimer: 0,

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

  // 表示範囲：全体表示は台紙全体、拡大表示は選択中のコマを中心に1.2コマ分
  x0: 0,            // 表示の左端（台紙px）
  visW: 1,          // 表示している幅（台紙px）

  resize() {
    if (!state.post) return;
    const b = boardSize(state.post.n), FW = CONFIG.GRID.FRAME_W;
    this.visW = state.zoom ? Math.min(b.w, FW * 1.2) : b.w;
    this.x0 = state.zoom ? clamp((state.frame + 0.5) * FW - this.visW / 2, 0, b.w - this.visW) : 0;
    const cssW = this.canvas.parentElement.clientWidth;
    const cssH = cssW * b.h / this.visW;
    const dpr = window.devicePixelRatio || 1;
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
    const gw = this.ghost, textStage = state.stage === 'text';
    drawGuides(ctx, state.post, {
      frame: state.frame,
      selected: state.selected,
      grid: !textStage && state.mode === 'grid',
      handles: textStage ? 'lr' : state.mode === 'free' && !gw,
      trace: this.trace,
      draft: this.draft,
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
      case 'draw':    this.draft = this.snapRect(normRect(g.start, p)); this.requestDraw(); break;
      case 'trace':   this.updateTrace(g, p); break;
      case 'pan':
      case 'pinch':   this.movePhoto(g); break;
    }
  },

  onUp(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.cancelPress();
    const g = this.gesture;
    if (this.pointers.size > 0) {
      // 2本指から1本指に戻ったら：マス設計は中の写真の移動を続ける、自由設計は指を離すまで何もしない
      if (g && (g.type === 'pinch' || g.type === 'scale')) {
        this.gesture = state.mode === 'grid' ? this.photoGesture() : { type: 'idle' };
      }
      return;
    }
    this.gesture = null;
    this.ghost = null;
    if (!g || cancelled) { this.trace = this.draft = null; this.requestDraw(); return; }
    switch (g.type) {
      case 'pending': this.tap(g.start); break;
      case 'draw':    this.finishDraw(); break;
      case 'trace':   this.finishTrace(); break;
      default:        onEditChanged(); break;
    }
  },

  beginSingle(p) {
    const sel = state.selected;
    if (state.stage === 'text') {
      const h = sel ? this.handleAt(sel, p, [6, 7]) : -1;
      this.gesture = h >= 0
        ? { type: 'resize', h, start: p, ...this.snapshot(sel) }
        : { type: 'pending', start: p, hit: this.hitAt(p) };
      return;
    }
    if (state.mode === 'free' && sel && state.poolPick == null) {
      const h = this.handleAt(sel, p);
      if (h >= 0) {
        this.gesture = { type: 'handle', h, start: p, ...this.snapshot(sel) };
        this.armPress();
        return;
      }
    }
    const hit = this.hitAt(p);
    this.gesture = { type: 'pending', start: p, hit };
    if (hit && hit === sel && state.mode === 'free') this.armPress();
  },

  beginMulti() {
    this.cancelPress();
    const g = this.gesture;
    if (g && g.type === 'pending' && g.hit) select(g.hit, g.start);
    this.trace = this.draft = null;
    const sel = state.selected;
    if (state.stage === 'text') {
      this.gesture = { type: 'idle' };
    } else if (state.mode === 'free' && sel) {
      this.gesture = { type: 'scale', m: this.centroid(), d: Math.max(1, this.spread()), ...this.snapshot(sel) };
    } else if (sel && sel.type === 'window') {
      this.gesture = this.photoGesture();
    } else {
      this.gesture = { type: 'idle' };
    }
    this.requestDraw();
  },

  // 操作開始時の状態（拡大縮小・切り取りの基準）
  snapshot(part) {
    return {
      rect: partRect(part),
      inner: innerRect(part),
      zoom: part.zoom, ox: part.offsetX, oy: part.offsetY,
    };
  },

  // ---------- 長押し：中の写真だけ動かす（拡大表示のとき） ----------

  armPress() {
    this.cancelPress();
    const sel = state.selected;
    if (!state.zoom || !sel || sel.type !== 'window') return;
    this.pressTimer = setTimeout(() => {
      this.pressTimer = 0;
      const g = this.gesture;
      if (!g || (g.type !== 'handle' && g.type !== 'pending') || this.pointers.size !== 1) return;
      this.gesture = this.photoGesture();
      this.ghost = sel;
      if (navigator.vibrate) navigator.vibrate(10);
      this.requestDraw();
    }, CONFIG.EDIT.LONG_PRESS_MS);
  },

  cancelPress() {
    if (this.pressTimer) { clearTimeout(this.pressTimer); this.pressTimer = 0; }
  },

  // 文字入れでは文字だけ、コマ編集では写真とベタだけを拾う。
  // マス設計では写真を優先（ベタの下の写真も触れるように）
  hitAt(p) {
    const parts = state.post.parts;
    if (state.stage === 'text') return partAt(parts, p.x, p.y, 'text');
    const notText = q => q.type !== 'text';
    if (state.mode === 'grid') return partAt(parts, p.x, p.y, 'window') || partAt(parts, p.x, p.y, notText);
    return partAt(parts, p.x, p.y, notText);
  },

  // タップ扱いの範囲を超えて動いた：何の操作かを決める
  promote(g, p) {
    const hit = g.hit;
    if (state.poolPick != null) { this.gesture = { type: 'idle' }; return; }
    if (state.stage === 'text') {
      if (hit) {
        select(hit, g.start);
        this.gesture = { type: 'move', start: g.start, rect: partRect(hit) };
      } else {
        this.gesture = { type: 'idle' };
      }
    } else if (state.mode === 'free') {
      if (hit) {
        select(hit, g.start);
        this.gesture = { type: 'move', start: g.start, rect: partRect(hit) };
      } else {
        this.gesture = { type: 'draw', start: g.start };
      }
    } else {
      if (hit && hit.type === 'window') {
        select(hit, g.start);
        this.gesture = this.photoGesture();
        this.ghost = hit;
      } else {
        this.gesture = { type: 'trace', a: cellAt(state.post.n, g.start.x, g.start.y) };
      }
    }
    this.onMove({ pointerId: [...this.pointers.keys()][0], clientX: p.cx, clientY: p.cy });
  },

  tap(p) {
    const hit = this.hitAt(p);
    const prev = state.frame;
    if (state.poolPick != null && hit && hit.type === 'window') putPhoto(hit, state.poolPick);
    select(hit, p);
    // 拡大表示で隣のコマをタップしたら、そのコマを中心に
    if (state.zoom && state.frame !== prev) this.resize();
  },

  // ---------- 自由設計：移動 ----------

  movePart(g, p) {
    const part = state.selected;
    if (!part) return;
    const r = { ...g.rect, x: g.rect.x + p.x - g.start.x, y: g.rect.y + p.y - g.start.y };
    part.free = this.snapMove(r);
    this.afterReshape(part);
  },

  // ---------- 自由設計：拡大縮小（枠と中身をまとめて等倍） ----------

  // 矩形 r に合わせて、中の写真も同じ倍率で拡大縮小する（見た目は相似形のまま）
  scaleTo(part, g, r) {
    part.free = roundRect(r);
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
    this.scaleTo(part, g, {
      x: m.x + (r0.x - g.m.x) * s, y: m.y + (r0.y - g.m.y) * s,
      w: r0.w * s, h: r0.h * s,
    });
  },

  // h: 0〜3 四隅（等倍の拡大縮小）、4〜7 辺の中央（上・下・左・右。切り取り方を変える）
  resizePart(g, p) {
    const part = state.selected;
    if (!part) return;
    const min = CONFIG.EDIT.MIN_FREE_SIZE;
    if (part.type === 'text') {
      // 文字は幅だけ。高さは中身から決まる
      const r0 = g.rect, R0 = r0.x + r0.w;
      const r = g.h === 6
        ? { x: Math.min(p.x, R0 - min * 2), w: 0 } : { x: r0.x, w: 0 };
      r.w = g.h === 6 ? R0 - r.x : Math.max(p.x - r0.x, min * 2);
      part.free = { ...part.free, ...roundRect({ x: r.x, y: r0.y, w: r.w, h: r0.h }) };
      this.requestDraw();
      return;
    }
    const r0 = g.rect, R0 = r0.x + r0.w, B0 = r0.y + r0.h;
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

  finishDraw() {
    const r = this.draft;
    this.draft = null;
    const min = CONFIG.EDIT.MIN_FREE_SIZE;
    if (r && r.w >= min && r.h >= min) addWindow({ free: roundRect(r) });
    this.requestDraw();
  },

  // only：調べるつまみの番号（省略時はすべて）
  handleAt(part, p, only) {
    const r = partRect(part);
    // 小さい写真でも本体をつかめるよう、当たり判定は短辺の25%まで
    const th = Math.min(CONFIG.EDIT.HANDLE_HIT * this.unitsPerCss(), Math.min(r.w, r.h) * 0.25);
    const pts = handlePoints(r);
    let best = -1, bestD = th;
    pts.forEach(([x, y], i) => {
      if (only && !only.includes(i)) return;
      const d = Math.hypot(p.x - x, p.y - y) + (i >= 4 ? th * 0.3 : 0); // 四隅を優先
      if (d < bestD) { best = i; bestD = d; }
    });
    return best;
  },

  // ---------- 吸着（コマの端・マス目） ----------

  snapLines() {
    const c = cellSize(), n = state.post.n;
    const xs = [], ys = [0, c.h, CONFIG.GRID.FRAME_H];
    for (let i = 0; i <= totalCols(n); i++) xs.push(i * c.w);
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

  snapRect(r) {
    return roundRect(this.snapEdges(r, 'l', 'r', 't', 'b'));
  },

  // ---------- マス設計：なぞり ----------

  updateTrace(g, p) {
    const span = cellSpan(g.a, cellAt(state.post.n, p.x, p.y));
    this.trace = { span, ok: !gridBlocked(state.post, span, null) };
    this.requestDraw();
  },

  finishTrace() {
    const t = this.trace;
    this.trace = null;
    if (t && t.ok) addWindow(t.span);
    this.requestDraw();
  },

  // ---------- 中の写真の移動・拡大縮小 ----------

  photoGesture() {
    const win = state.selected;
    const n = this.pointers.size;
    if (!win || win.type !== 'window' || n === 0) return { type: 'idle' };
    const m = this.centroid();
    const r = innerRect(win);
    const rcx = r.x + r.w / 2, rcy = r.y + r.h / 2;
    return {
      type: n >= 2 ? 'pinch' : 'pan',
      m, ox: win.offsetX, oy: win.offsetY,
      zoom: win.zoom, d: n >= 2 ? Math.max(1, this.spread()) : 1,
      rcx, rcy, cx: rcx + win.offsetX, cy: rcy + win.offsetY, // 写真中心
    };
  },

  movePhoto(g) {
    const win = state.selected;
    const photo = win && state.photos[win.photo];
    if (!photo) return;
    const m = this.centroid();
    if (g.type === 'pan') {
      win.offsetX = g.ox + (m.x - g.m.x);
      win.offsetY = g.oy + (m.y - g.m.y);
    } else {
      // 2本指の中点の下にある写真の点を固定したまま拡大縮小・移動
      const zoom = clamp(g.zoom * this.spread() / g.d, CONFIG.ZOOM.MIN, CONFIG.ZOOM.MAX);
      const s = zoom / g.zoom;
      win.zoom = zoom;
      win.offsetX = m.x - (g.m.x - g.cx) * s - g.rcx;
      win.offsetY = m.y - (g.m.y - g.cy) * s - g.rcy;
    }
    clampWindow(win, photo);
    this.requestDraw();
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

function normRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// 自由矩形は整数に丸める（半端な画素で縁に隙間を作らない）
function roundRect(r) {
  const x = Math.round(r.x), y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
}
