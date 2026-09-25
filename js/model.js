// ============================================================
// 部品の定義・座標計算・置き方（カセット）・コマ操作・スタイル
// 台紙は幅 FRAME_W×N、高さ FRAME_H の1枚の座標系。
// 部品はすべてこの台紙上の絶対座標（free: {x,y,w,h}）で持つ。
// post.parts は描画順（後ろほど上）の1本の配列。
// 編集の単位は写真1枚。カセットも「選択中の写真1枚の置き方」でしかない。
// ============================================================

// ---------- 座標計算 ----------

function boardSize(n) {
  const g = CONFIG.GRID;
  return { w: g.FRAME_W * n, h: g.FRAME_H };
}

// グリッドの1マス（正方形）
function gridCell() {
  const g = CONFIG.GRID;
  return { w: g.FRAME_W / g.SNAP_COLS, h: g.FRAME_H / g.SNAP_ROWS };
}

function frameAt(n, bx) {
  return Math.min(n - 1, Math.max(0, Math.floor(bx / CONFIG.GRID.FRAME_W)));
}

function frameRect(f) {
  const g = CONFIG.GRID;
  return { x: f * g.FRAME_W, y: 0, w: g.FRAME_W, h: g.FRAME_H };
}

function partRect(part) {
  return { ...part.free };
}

// 写真を描く内側の矩形（白フチの分を除く）
function innerRect(part) {
  const r = partRect(part);
  if (!part.border) return r;
  const b = Math.min(CONFIG.BORDER.width, r.w / 4, r.h / 4);
  return { x: r.x + b, y: r.y + b, w: r.w - b * 2, h: r.h - b * 2 };
}

// 部品の「持ち主」のコマ：左端のコマ幅の中央が入っているコマ
// （2コマにわたる写真は始まりのコマ、左に切れる写真は見えている側のコマ）
function homeFrame(post, part) {
  const r = partRect(part);
  return frameAt(post.n, r.x + Math.min(r.w, CONFIG.GRID.FRAME_W) / 2);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function rectContains(r, x, y) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

// 点に当たる一番上の部品。type は種類名か、部品を受け取って真偽を返す関数
function partAt(parts, bx, by, type) {
  const ok = typeof type === 'function' ? type : p => !type || p.type === type;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!ok(p)) continue;
    if (rectContains(partRect(p), bx, by)) return p;
  }
  return null;
}

// ---------- 部品の定義（この3種類のみ） ----------

let _partSeq = 0;
function nextId() { return 'p' + (++_partSeq); }

// 窓（画面上は「写真」）：写真を表示する矩形
//  cassette … 最後に選んだ置き方（CASSETTES のキー）。手で動かすと null
//  clip     … true なら自分のコマの外は切る（はみ出して切れる置き方）
//  tone     … { mode: CONFIG.TONE.modes の id, strength: CONFIG.TONE.strengths の id }
function makeWindow({ free, photo = 0, cassette = null, clip = false, border = false }) {
  return {
    id: nextId(), type: 'window', free, photo, cassette, clip, border,
    zoom: 1,        // cover基準の拡大率（1でちょうど埋まる）
    offsetX: 0,     // 台紙px。中央からのずれ
    offsetY: 0,
    tone: { mode: 'none', strength: 'standard' },
  };
}

// ベタ：単色の矩形。color は #rrggbb（基調色とは独立）
function makeBeta({ free, color = CONFIG.BG.BETA_DEFAULT }) {
  return { id: nextId(), type: 'beta', free, color };
}

// 文字：幅は free.w、高さは中身から自動で決まる（layoutText）
function makeText({ x, y, w, text = '' }) {
  return {
    id: nextId(), type: 'text', free: { x, y, w, h: 0 }, text,
    family: 'gothic', weight: 'normal', italic: false,
    role: 'title', lineHeight: 'standard', color: 'accent', align: 'left',
  };
}

// ---------- 投稿 ----------

function createPost(n) {
  // accent  … 基調色（CONFIG.ACCENTS の id）。写真の単色系と文字色に使う
  // frameBg … コマごとの背景色 #rrggbb（基調色とは独立）
  return { n, accent: CONFIG.ACCENT_DEFAULT, frameBg: Array(n).fill(CONFIG.BG.DEFAULT), parts: [] };
}

// ---------- 置き方（カセット）：写真1枚に対するもの ----------
// rect はコマの左上を原点にした矩形（台紙px）。span は必要なコマ数。clip はコマの外を切るか。

const FW = CONFIG.GRID.FRAME_W, FH = CONFIG.GRID.FRAME_H;
const CASSETTES = {
  full:        { label: '1コマ全面',     span: 1, rect: { x: 0, y: 0, w: FW, h: FH } },
  span2:       { label: '2コマにわたる', span: 2, rect: { x: 0, y: 0, w: FW * 2, h: FH } },
  span3:       { label: '3コマにわたる', span: 3, rect: { x: 0, y: 0, w: FW * 3, h: FH } },
  top:         { label: '上半分',   span: 1, rect: { x: 0, y: 0, w: FW, h: FH / 2 } },
  bottom:      { label: '下半分',   span: 1, rect: { x: 0, y: FH / 2, w: FW, h: FH / 2 } },
  left:        { label: '左半分',   span: 1, rect: { x: 0, y: 0, w: FW / 2, h: FH } },
  right:       { label: '右半分',   span: 1, rect: { x: FW / 2, y: 0, w: FW / 2, h: FH } },
  smallCenter: { label: '小・中央', span: 1, rect: { x: 270, y: 337.5, w: 540, h: 675 } },
  smallTL:     { label: '小・左上', span: 1, rect: { x: 67.5, y: 67.5, w: 472.5, h: 607.5 } },
  smallBL:     { label: '小・左下', span: 1, rect: { x: 67.5, y: 675, w: 472.5, h: 607.5 } },
  smallBR:     { label: '小・右下', span: 1, rect: { x: 540, y: 675, w: 472.5, h: 607.5 } },
  bleedLeft:   { label: '左に切れる', span: 1, clip: true, rect: { x: -337.5, y: 135, w: 945, h: 1080 } },
  bleedRight:  { label: '右に切れる', span: 1, clip: true, rect: { x: 472.5, y: 135, w: 945, h: 1080 } },
};

// 写真 win をコマ f に置き方 key で置く。他の写真の中身（写真・寄せ・色調）は変えない。
//  ・1コマの置き方：その写真の枠を決めるだけ
//  ・複数コマの置き方：右へ伸ばし、重なる写真に場所を空けさせる（makeRoom）。コマが足りなければ足す
// photos は隣の写真の枠を狭めるときに使う（cover のまま切り取るため）。返り値：{ ok } か { error }
function applyCassette(post, win, f, key, photos) {
  const c = CASSETTES[key];
  const before = JSON.stringify(post);
  if (c.span > 1) {
    // 継ぎ目を動かした後などで、写真がこのコマの途中から始まっていれば左端はそのまま。右へ伸ばす
    const r0 = partRect(win), fl = f * FW;
    const midStart = r0.y === 0 && r0.h === FH && r0.x > fl && r0.x < fl + FW - CONFIG.EDIT.MIN_KEEP_W;
    const left = midStart ? r0.x : fl;
    win.free = { x: left, y: 0, w: (f + c.span) * FW - left, h: FH };
    win.cassette = key;
    win.clip = false;
    makeRoom(post, win, photos || []);
  } else {
    const r = c.rect;
    win.free = { x: f * FW + r.x, y: r.y, w: r.w, h: r.h };
    win.cassette = key;
    win.clip = !!c.clip;
  }
  const r = partRect(win);
  while (post.n * FW < r.x + r.w - 0.5) { post.frameBg.push(post.frameBg[post.n - 1] || CONFIG.BG.DEFAULT); post.n++; }
  if (post.n > CONFIG.GRID.MAX_FRAMES) {
    Object.assign(post, JSON.parse(before)); // 元に戻す（win は別物になるので、呼び出し側は id で選び直す）
    return { error: `コマは${CONFIG.GRID.MAX_FRAMES}コマまでです。` };
  }
  return { ok: true };
}

// 写真 P と重なる写真に場所を空けさせる。重なりは残さず、写真を消しもしない
//  ・左から掛かっている写真：右端を P の左端まで詰める
//  ・右に掛かっている写真：残りが MIN_KEEP_W 以上なら左端を P の右端まで詰める（枠だけ狭め、中身は cover のまま切り取る）
//                          足りなければ、その写真のコマから後ろを必要なコマ数だけ後ろへ送る（コマを挿入）
function makeRoom(post, P, photos) {
  const MIN = CONFIG.EDIT.MIN_KEEP_W, done = new Set();
  for (let guard = 0; guard < 100; guard++) {
    const r = partRect(P);
    const q = post.parts
      .filter(o => o !== P && o.type === 'window' && !done.has(o) && rectsOverlap(partRect(o), r))
      .sort((a, b) => partRect(a).x - partRect(b).x)[0];
    if (!q) return;
    const qr = partRect(q), pr = r.x + r.w, qrR = qr.x + qr.w;
    if (qr.x < r.x) {
      reframeWindow(q, { ...qr, w: Math.max(CONFIG.EDIT.MIN_FREE_SIZE, r.x - qr.x) }, photos[q.photo]);
      q.cassette = null;
      done.add(q);
    } else if (qrR - pr >= MIN) {
      reframeWindow(q, { x: pr, y: qr.y, w: qrR - pr, h: qr.h }, photos[q.photo]);
      q.cassette = null;
    } else {
      const at = homeFrame(post, q);
      insertFramesAt(post, at, Math.ceil((pr - qr.x) / FW - 1e-6), [P], post.frameBg[Math.max(0, at - 1)]);
    }
  }
}

// at 番目の位置に k コマ挿入し、at 以降に属する部品を後ろへ送る（exclude の部品は動かさない）
function insertFramesAt(post, at, k, exclude = [], bg) {
  const home = new Map(post.parts.map(p => [p, homeFrame(post, p)]));
  for (const p of post.parts) if (!exclude.includes(p) && home.get(p) >= at) shiftPart(p, k);
  post.frameBg.splice(at, 0, ...Array(k).fill(bg || CONFIG.BG.DEFAULT));
  post.n += k;
}

// 継ぎ目：左右に隣り合う写真の境目のうち、複数コマにわたる写真に接するもの（または途中に動かしたもの）
// { left, right, x, top, bottom } の配列
function findSeams(post) {
  const wins = post.parts.filter(p => p.type === 'window');
  const seams = [];
  for (const a of wins) {
    const ar = partRect(a);
    for (const b of wins) {
      if (a === b) continue;
      const br = partRect(b);
      if (Math.abs(ar.x + ar.w - br.x) > 0.75) continue;
      const top = Math.max(ar.y, br.y), bottom = Math.min(ar.y + ar.h, br.y + br.h);
      if (bottom - top < 60) continue;
      const offFrameEdge = Math.abs(br.x / FW - Math.round(br.x / FW)) * FW > 0.75;
      if (ar.w > FW + 0.75 || br.w > FW + 0.75 || offFrameEdge) seams.push({ left: a, right: b, x: br.x, top, bottom });
    }
  }
  return seams;
}

// ---------- 写真の割り当て ----------

function photoUsage(post, photoCount) {
  const use = Array(photoCount).fill(0);
  for (const p of post.parts) if (p.type === 'window' && p.photo < photoCount) use[p.photo]++;
  return use;
}

// 使われている回数が少ない写真から選ぶ
function leastUsedPhoto(post, photoCount) {
  const use = photoUsage(post, photoCount);
  let best = 0;
  for (let i = 1; i < photoCount; i++) if (use[i] < use[best]) best = i;
  return best;
}

// 組み上げ：写真1枚＝1コマ全面。写真の並び順がそのままコマの順
function buildFromPhotos(photoCount) {
  const post = createPost(Math.max(1, photoCount));
  for (let f = 0; f < post.n; f++) {
    const w = makeWindow({ free: { x: 0, y: 0, w: 1, h: 1 }, photo: f });
    applyCassette(post, w, f, 'full');
    post.parts.push(w);
  }
  return post;
}

// map[旧番号] = 新番号（削除された写真は -1）。削除された写真の枠は、残りの写真で埋める
function remapPhotos(post, map, photoCount) {
  const lost = [];
  for (const p of post.parts) {
    if (p.type !== 'window') continue;
    const np = map[p.photo];
    if (np == null || np < 0) { lost.push(p); p.photo = -1; } else p.photo = np;
  }
  for (const p of lost) p.photo = photoCount > 0 ? leastUsedPhoto(post, photoCount) : 0;
  return lost;
}

// ---------- コマの追加・削除 ----------

function shiftPart(p, frames) {
  p.free.x += frames * FW;
}

// コマ f の後ろに空のコマを1つ挿入する（後ろのコマは押し出す）
function addFrameAfter(post, f) {
  if (post.n >= CONFIG.GRID.MAX_FRAMES) return false;
  const home = new Map(post.parts.map(p => [p, homeFrame(post, p)]));
  for (const p of post.parts) if (home.get(p) > f) shiftPart(p, 1);
  post.frameBg.splice(f + 1, 0, post.frameBg[f]);
  post.n++;
  return true;
}

// コマ f を取り除く（f に属する部品も消え、右側は詰める）
function deleteFrame(post, f) {
  if (post.n <= CONFIG.GRID.MIN_FRAMES) return false;
  const home = new Map(post.parts.map(p => [p, homeFrame(post, p)]));
  post.parts = post.parts.filter(p => home.get(p) !== f);
  for (const p of post.parts) if (home.get(p) > f) shiftPart(p, -1);
  post.frameBg.splice(f, 1);
  post.n--;
  return true;
}

// ---------- スタイル（写真そのものは持たない） ----------
// 保存するもの：コマ数、各写真の配置（位置・大きさ・置き方・切り方・中身の寄せ）、色調、基調色、背景色

function postToStyle(post, photoCount, name) {
  return {
    v: 1, name, photoCount, createdAt: Date.now(),
    n: post.n, accent: post.accent, frameBg: [...post.frameBg],
    windows: post.parts.filter(p => p.type === 'window').map(p => ({
      photo: p.photo, free: { ...p.free }, cassette: p.cassette, clip: p.clip, border: p.border,
      zoom: p.zoom, offsetX: p.offsetX, offsetY: p.offsetY, tone: { ...p.tone },
    })),
  };
}

// スタイルから投稿を作る。写真は番号どおり（＝今の並び順）に割り当てる。
// keepTexts … 今の投稿の文字を引き継ぐ（コマ数を超える分は捨てる）
function postFromStyle(style, keepTexts) {
  const post = createPost(style.n);
  post.accent = style.accent;
  post.frameBg = [...style.frameBg];
  for (const w of style.windows) {
    const win = makeWindow({ free: { ...w.free }, photo: w.photo, cassette: w.cassette, clip: w.clip, border: w.border });
    Object.assign(win, { zoom: w.zoom, offsetX: w.offsetX, offsetY: w.offsetY, tone: { ...w.tone } });
    post.parts.push(win);
  }
  for (const t of keepTexts || []) if (t.free.x < post.n * FW) post.parts.push(t);
  return post;
}
