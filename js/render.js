// ============================================================
// 描画
// drawPost は「台紙座標で描く」だけを知っている。
// 表示用・書き出し用の違いは呼び出し側が ctx の変換で吸収する。
// ============================================================

function drawPost(ctx, post, photos) {
  // コマの背景（外周を必ず塗りきる）
  for (let f = 0; f < post.n; f++) {
    const r = frameRect(f);
    ctx.fillStyle = post.frameBg[f];
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  for (const part of post.parts) {
    switch (part.type) {
      case 'beta':   drawBeta(ctx, part, post); break;
      case 'window': drawWindow(ctx, part, photos[part.photo], post); break;
      case 'text':   drawText(ctx, part, post); break;
    }
  }
}

function drawBeta(ctx, part, post) {
  const r = partRect(part);
  ctx.fillStyle = resolveColor(part.color, post);
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

// ---------- 文字 ----------
// 書体・太さ・斜体・級数・行間は CONFIG.TYPE から。1文字ずつ置いて字間を開ける。
// 折り返しは文字単位。句読点・閉じ括弧は行頭に来ないよう前の行にぶら下げる。

const _measure = document.createElement('canvas').getContext('2d');
const _layoutCache = new Map();
const KINSOKU_HEAD = '、。，．,.）」』】〕〉》！？!?ー…ゃゅょっァィゥェォャュョッ';

function pick(list, id) {
  return list.find(x => x.id === id) || list[0];
}

function roleOf(id) { return pick(CONFIG.TYPE.roles, id); }

// 文字部品のフォント指定（書体・太さ・斜体・級数）
function fontOf(part) {
  const T = CONFIG.TYPE;
  const w = pick(T.weights, part.weight).value;
  return `${part.italic ? 'italic ' : ''}${w} ${roleOf(part.role).size}px ${pick(T.families, part.family).css}`;
}

// フォントの読み込みで字幅が変わったら呼ぶ
function clearTextLayout() { _layoutCache.clear(); }

// 行に分ける。{ lines: [{ chars, width }], lineH, size, ls } を返し、part.free.h を更新する
function layoutText(part) {
  const role = roleOf(part.role), T = CONFIG.TYPE;
  const font = fontOf(part);
  const key = `${font}|${part.lineHeight}|${part.free.w}|${part.text}`;
  let L = _layoutCache.get(key);
  if (!L) {
    _measure.font = font;
    const ls = role.size * T.letterSpacing;
    const maxW = part.free.w;
    const lines = [];
    for (const para of (part.text || '').split('\n')) {
      let cur = [], w = 0;
      for (const ch of Array.from(para)) {
        const cw = _measure.measureText(ch).width + ls;
        if (cur.length && w + cw - ls > maxW && !KINSOKU_HEAD.includes(ch)) {
          lines.push({ chars: cur, width: w - ls });
          cur = []; w = 0;
        }
        cur.push([ch, cw]); w += cw;
      }
      lines.push({ chars: cur, width: Math.max(0, w - ls) });
    }
    L = { lines, lineH: role.size * pick(T.lineHeights, part.lineHeight).value, size: role.size, ls };
    _layoutCache.set(key, L);
    if (_layoutCache.size > 200) _layoutCache.delete(_layoutCache.keys().next().value);
  }
  part.free.h = Math.max(1, L.lines.length) * L.lineH;
  return L;
}

function drawText(ctx, part, post) {
  if (!part.text) return;
  const L = layoutText(part), r = part.free;
  ctx.save();
  ctx.font = fontOf(part);
  ctx.fillStyle = resolveColor(part.color, post);
  ctx.textBaseline = 'middle';
  L.lines.forEach((line, i) => {
    let x = r.x;
    if (part.align === 'center') x += (r.w - line.width) / 2;
    if (part.align === 'right') x += r.w - line.width;
    const y = r.y + L.lineH * (i + 0.5);
    for (const [ch, cw] of line.chars) { ctx.fillText(ch, x, y); x += cw; }
  });
  ctx.restore();
}

// 書き出し・プレビューの前に、使っている文字のフォントを読み込んでおく
async function ensureFonts(post) {
  if (!document.fonts || !document.fonts.load) return;
  const jobs = post.parts.filter(p => p.type === 'text' && p.text)
    .map(p => document.fonts.load(fontOf(p), p.text).catch(() => {}));
  const timeout = new Promise(r => setTimeout(r, 4000)); // オフラインでも止まらないように
  await Promise.race([Promise.all(jobs), timeout]);
  clearTextLayout();
}


// ---------- 窓（cover） ----------

function expandRect(r, d) {
  return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 };
}

function coverScale(rect, photo) {
  return Math.max(rect.w / photo.w, rect.h / photo.h);
}

// 写真は窓の内側より BLEED だけ大きい矩形を覆うように置き、窓で切り抜く。
// これで写真の縁が窓の縁に来ることはなく、白線が出ない。
function coverPlacement(win, photo) {
  const r = innerRect(win);
  const rb = expandRect(r, CONFIG.BLEED);
  const s = coverScale(rb, photo) * win.zoom;
  const dw = photo.w * s, dh = photo.h * s;
  const maxX = Math.max(0, (dw - rb.w) / 2), maxY = Math.max(0, (dh - rb.h) / 2);
  const ox = clamp(win.offsetX, -maxX, maxX);
  const oy = clamp(win.offsetY, -maxY, maxY);
  return {
    rect: r, dw, dh, maxX, maxY,
    dx: r.x + (r.w - dw) / 2 + ox,
    dy: r.y + (r.h - dh) / 2 + oy,
  };
}

// 拡大率とオフセットを有効な範囲に丸める（操作後に呼ぶ）
function clampWindow(win, photo) {
  win.zoom = clamp(win.zoom, CONFIG.ZOOM.MIN, CONFIG.ZOOM.MAX);
  const pl = coverPlacement(win, photo);
  win.offsetX = clamp(win.offsetX, -pl.maxX, pl.maxX);
  win.offsetY = clamp(win.offsetY, -pl.maxY, pl.maxY);
}

// 枠だけを rect に変える。中の写真は画面上の同じ位置・大きさに残し、はみ出す分は切り取る（cover のまま）。
// 枠が写真より大きくなるときだけ、覆えるところまで写真を大きくする。歪めることはない。
// snap … 操作を始めたときの { inner, zoom, ox, oy }（ドラッグ中に誤差がたまらないように）。省略すると今の状態
function reframeWindow(win, rect, photo, snap) {
  snap = snap || { inner: innerRect(win), zoom: win.zoom, ox: win.offsetX, oy: win.offsetY };
  win.free = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  if (!photo) return;
  const inner0 = snap.inner, inner1 = innerRect(win);
  const absScale = coverScale(expandRect(inner0, CONFIG.BLEED), photo) * snap.zoom;
  const cx = inner0.x + inner0.w / 2 + snap.ox, cy = inner0.y + inner0.h / 2 + snap.oy; // 写真の中心
  win.zoom = absScale / coverScale(expandRect(inner1, CONFIG.BLEED), photo);
  win.offsetX = cx - (inner1.x + inner1.w / 2);
  win.offsetY = cy - (inner1.y + inner1.h / 2);
  clampWindow(win, photo);
}

// 写真を入れ直した窓を初期状態に整える
function fitWindow(win, photos) {
  const photo = photos[win.photo];
  if (!photo) return;
  win.zoom = 1; win.offsetX = 0; win.offsetY = 0;
  clampWindow(win, photo);
}

function drawWindow(ctx, win, photo, post) {
  const r = partRect(win);
  const inner = innerRect(win);

  if (win.border) {
    const B = CONFIG.BORDER;
    const k = ctx.getTransform().a; // 影はctxの拡大に追従しないので自前で掛ける
    ctx.save();
    ctx.shadowColor = B.shadowColor;
    ctx.shadowBlur = B.shadowBlur * k;
    ctx.shadowOffsetY = B.shadowOffsetY * k;
    ctx.fillStyle = B.color;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  if (!photo) {
    ctx.fillStyle = '#444';
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    return;
  }
  const pl = coverPlacement(win, photo);
  ctx.save();
  if (win.clip) { // はみ出して切れる置き方：自分のコマの外は描かない
    const fr = frameRect(homeFrame(post, win));
    ctx.beginPath();
    ctx.rect(fr.x, fr.y, fr.w, fr.h);
    ctx.clip();
  }
  ctx.beginPath();
  ctx.rect(inner.x, inner.y, inner.w, inner.h);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(toneSource(photo, win.tone, post), pl.dx, pl.dy, pl.dw, pl.dh);
  ctx.restore();
}

// ---------- 色調 ----------
// 単色系で乗る色は投稿の基調色。基調色を変えるとキャッシュのキーが変わり、一斉に作り直される。

function toneKey(tone, post) {
  if (!tone || tone.mode === 'none') return null;
  const s = tone.strength || 'standard';
  if (tone.mode === 'pale') return `pale:${s}`;
  return `${tone.mode}:${s}:${accentOf(post).photo}`;
}

// 色調を掛けた写真のCanvas。写真×色調ごとに1回だけ作ってキャッシュする。
// ctx.filter は Safari で使えない版があるため画素を直接処理する。
function toneSource(photo, tone, post) {
  const key = toneKey(tone, post);
  if (!key) return photo.canvas;
  photo.toneCache = photo.toneCache || {};
  if (photo.toneCache[key]) return photo.toneCache[key];

  const T = CONFIG.TONE, s = tone.strength || 'standard';
  const c = document.createElement('canvas');
  c.width = photo.w; c.height = photo.h;
  const ctx = c.getContext('2d');
  ctx.drawImage(photo.canvas, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;

  if (tone.mode === 'pale') {
    // 淡い：明度はそのまま、彩度だけ落とす
    const k = 1 - T.pale[s];
    for (let i = 0; i < d.length; i += 4) {
      const y = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      d[i] = y + (d[i] - y) * k;
      d[i + 1] = y + (d[i + 1] - y) * k;
      d[i + 2] = y + (d[i + 2] - y) * k;
    }
  } else {
    // 単色・淡い単色：モノクロ → 明度ごとの色表で基調色を乗せる
    const lut = duoLut(accentOf(post).photo, T[tone.mode][s], T.duoHighlight);
    for (let i = 0; i < d.length; i += 4) {
      const y = Math.round(d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) * 3;
      d[i] = lut[y]; d[i + 1] = lut[y + 1]; d[i + 2] = lut[y + 2];
    }
  }
  ctx.putImageData(img, 0, 0);
  photo.toneCache[key] = c;
  return c;
}

// 明度0〜255ごとの色。基調色の色相・彩度に写真の明度を与え（color ブレンド）、
// 効きを暗い側ほど強く、明るい側ほど弱くする（明るい側は白へ抜ける）。
// 灰色と同じ明度の色を混ぜるだけなので、明度は保たれる。
function duoLut(hex, amount, highlight) {
  const lut = new Uint8ClampedArray(256 * 3);
  const C = hexToRgb(hex);
  const lum = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
  const lc = lum(...C);
  for (let L = 0; L < 256; L++) {
    let c = C.map(v => v + (L - lc));
    // ClipColor（W3C の color ブレンドと同じ手順）
    const l = lum(...c), n = Math.min(...c), x = Math.max(...c);
    if (n < 0) c = c.map(v => l + (v - l) * l / (l - n));
    if (x > 255) c = c.map(v => l + (v - l) * (255 - l) / (x - l));
    const k = amount * (1 - Math.pow(L / 255, highlight));
    for (let j = 0; j < 3; j++) lut[L * 3 + j] = L + (c[j] - L) * k;
  }
  return lut;
}

// 使われなくなった色調キャッシュを捨てる（iOSのCanvasメモリ対策）
function pruneToneCache(post, photos) {
  const used = photos.map(() => new Set());
  for (const p of post.parts) {
    if (p.type !== 'window' || !used[p.photo]) continue;
    const k = toneKey(p.tone, post);
    if (k) used[p.photo].add(k);
  }
  photos.forEach((ph, i) => {
    if (!ph.toneCache) return;
    for (const k of Object.keys(ph.toneCache)) {
      if (!used[i].has(k)) { ph.toneCache[k].width = 0; delete ph.toneCache[k]; }
    }
  });
}

// ---------- 編集画面用の補助線 ----------
// view: { frame, selected, grid, handles, ghost, seams }
// cssPx: 画面1css pxあたりの台紙px

function drawGuides(ctx, post, view, cssPx) {
  const g = CONFIG.GRID;
  const b = boardSize(post.n);
  const px = v => v * cssPx;
  ctx.save();

  // 中の写真だけ動かしている間：枠の外にはみ出た部分を薄く見せる
  if (view.ghost) {
    const { win, photo } = view.ghost;
    const pl = coverPlacement(win, photo);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(toneSource(photo, win.tone, post), pl.dx, pl.dy, pl.dw, pl.dh);
    ctx.globalAlpha = 1;
    drawWindow(ctx, win, photo, post);
  }

  // グリッド（表示中のみ。細かい正方形）
  if (view.grid) {
    const c = gridCell();
    ctx.strokeStyle = 'rgba(0,160,255,0.35)';
    ctx.lineWidth = px(1);
    ctx.beginPath();
    for (let x = c.w; x < b.w; x += c.w) { ctx.moveTo(x, 0); ctx.lineTo(x, b.h); }
    for (let y = c.h; y < b.h; y += c.h) { ctx.moveTo(0, y); ctx.lineTo(b.w, y); }
    ctx.stroke();
  }

  // コマの境目（薄い線）
  ctx.strokeStyle = 'rgba(128,128,128,0.8)';
  ctx.lineWidth = px(1);
  ctx.setLineDash([px(6), px(4)]);
  for (let i = 1; i < post.n; i++) {
    const x = i * g.FRAME_W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, b.h); ctx.stroke();
  }
  ctx.setLineDash([]);

  // 選択中のコマ
  if (view.frame != null) {
    const r = frameRect(view.frame);
    ctx.strokeStyle = '#fc3';
    ctx.lineWidth = px(3);
    ctx.strokeRect(r.x + px(1.5), r.y + px(1.5), r.w - px(3), r.h - px(3));
  }

  // 継ぎ目のバー（左右にドラッグして境目を動かす）
  for (const sm of view.seams || []) {
    const b = seamBar(sm, cssPx);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = px(4);
    ctx.fillStyle = '#fff';
    roundRectPath(ctx, b.x, b.y, b.w, b.h, b.w / 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#4af';
    ctx.lineWidth = px(1.5);
    roundRectPath(ctx, b.x, b.y, b.w, b.h, b.w / 2);
    ctx.stroke();
    ctx.beginPath();
    for (const dy of [-px(6), 0, px(6)]) { ctx.moveTo(b.x + px(3.5), b.y + b.h / 2 + dy); ctx.lineTo(b.x + b.w - px(3.5), b.y + b.h / 2 + dy); }
    ctx.stroke();
  }

  // 選択中の部品とつまみ
  if (view.selected) {
    const r = partRect(view.selected);
    ctx.strokeStyle = { beta: '#f6a', text: '#fc3' }[view.selected.type] || '#4af';
    ctx.lineWidth = px(2);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    if (view.handles) {
      ctx.fillStyle = '#fff';
      handlePoints(r).forEach(([x, y], i) => {
        if (view.handles === 'lr' && i < 6) return; // 文字は左右の幅だけ
        ctx.beginPath();
        if (i < 4) ctx.arc(x, y, px(7), 0, Math.PI * 2);
        else ctx.rect(x - px(5), y - px(5), px(10), px(10));
        ctx.fill(); ctx.stroke();
      });
    }
  }
  ctx.restore();
}

// 継ぎ目のバーの矩形（台紙px）。cssPx は画面1css pxあたりの台紙px
function seamBar(sm, cssPx) {
  const w = 16 * cssPx, h = Math.min((sm.bottom - sm.top) * 0.4, 80 * cssPx);
  return { x: sm.x - w / 2, y: (sm.top + sm.bottom) / 2 - h / 2, w, h };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// つまみの位置：0〜3 四隅（左上・右上・左下・右下）、4〜7 辺の中央（上・下・左・右）
function handlePoints(r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.x + r.w, B = r.y + r.h;
  return [[r.x, r.y], [R, r.y], [r.x, B], [R, B], [cx, r.y], [cx, B], [r.x, cy], [R, cy]];
}

// ---------- 書き出し ----------

// i 枚目のコマを EXPORT.SCALE 倍で描いた Blob を返す
function exportFrame(post, photos, i) {
  const g = CONFIG.GRID, e = CONFIG.EXPORT;
  const c = document.createElement('canvas');
  c.width = g.FRAME_W * e.SCALE;
  c.height = g.FRAME_H * e.SCALE;
  const ctx = c.getContext('2d');
  // 平行移動は整数ピクセルに揃える（コマの境目で半端な画素を作らない）
  ctx.setTransform(e.SCALE, 0, 0, e.SCALE, -Math.round(g.FRAME_W * i * e.SCALE), 0);
  drawPost(ctx, post, photos);
  return new Promise((resolve, reject) => {
    c.toBlob(b => {
      // iOSのCanvasメモリ上限対策に即解放
      c.width = c.height = 0;
      b ? resolve(b) : reject(new Error('toBlob失敗'));
    }, e.MIME, e.QUALITY);
  });
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
