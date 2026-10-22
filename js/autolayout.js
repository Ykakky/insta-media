// ============================================================
// おまかせ配置：並べた順の写真から、誌面のように組み上がった状態を作る
//
// 考え方（雑誌のページ作りを手順にしたもの）
//  ・写真の順番は変えない（並べ替えはユーザーが決めたもの）。変えるのは置き方だけ
//  ・1枚目は表紙。全面か、大きく見せる
//  ・「全面で見せる」と「余白で見せる」を交互にしてリズムを作る。同じ型は続けない
//  ・横長は2コマにまたがるパノラマや上下の分割、縦長は全面や余白のある配置に
//  ・余白のある配置は写真の縦横比に合わせ、なるべく切り取らずに見せる
//  ・余白の幅と寄せる側（左右）は1つの投稿の中で揃える。位置はすべてグリッド線に揃える
//  ・背景は写真の平均色から作った色か、白・生成りなどを1つ選び、全コマで揃える
//  ・ストーリーズでは、上下のUIに隠れやすい範囲（safeTop / safeBottom）を避ける
// 毎回少しずつ違う結果になる。気に入らなければ何度でも組み直せる。
// ============================================================

const AUTO = {
  MAX_FRAMES: CONFIG.GRID.MAX_FRAMES,
  // ブロックの重み（大きいほど選ばれやすい）
  WEIGHTS: { full: 3, pano: 3, framed: 3, split: 2, duo: 2, bridge: 1.6 },
  REPEAT_PENALTY: 0.12,  // 直前と同じ型
  BLEED_RUN_PENALTY: 0.3, // 「全面」系が2回続いたら、次の「全面」系はさらに選ばれにくく
  RHYTHM_BONUS: 1.7,     // 「全面」の次に「余白」、「余白」の次に「全面」
  // 背景の候補と重み。tint / deep は写真の平均色から作る
  BACKGROUNDS: [
    { id: 'white',  w: 3,   color: () => '#ffffff' },
    { id: 'kinari', w: 2,   color: () => '#f3eee3' },
    { id: 'paper',  w: 1,   color: () => '#e8e7e3' },
    { id: 'tint',   w: 2.5, color: h => hslToHex(h.h, Math.min(h.s, 28), 93) },
    { id: 'deep',   w: 1.5, color: h => hslToHex(h.h, Math.min(h.s, 30), 15) },
  ],
};

const BLEED_TYPES = new Set(['full', 'pano', 'split']);

function pickWeighted(items) {
  const total = items.reduce((a, it) => a + it.w, 0);
  let r = Math.random() * total;
  for (const it of items) { if ((r -= it.w) <= 0) return it; }
  return items[items.length - 1];
}

const rnd = (a, b) => a + Math.random() * (b - a);
const ratioOf = ph => ph.w / ph.h;
const isLand = ph => ratioOf(ph) > 1.15;
const isPort = ph => ratioOf(ph) < 0.87;

// ---------- 写真の色から、背景色と基調色を選ぶ ----------

function photoHsl(photos) {
  const sum = [0, 0, 0];
  let n = 0;
  for (const p of photos) if (p.avg) { p.avg.forEach((v, i) => { sum[i] += v; }); n++; }
  return hexToHsl(n ? rgbToHex(sum.map(v => v / n)) : '#888888');
}

function pickAccent(hsl) {
  if (hsl.s < 12) return Math.random() < 0.5 ? 'black' : 'gray';
  let best = CONFIG.ACCENTS[0].id, bd = Infinity;
  for (const a of CONFIG.ACCENTS) {
    const ah = hexToHsl(a.photo);
    if (ah.s < 15) continue;
    const d = Math.min(Math.abs(ah.h - hsl.h), 360 - Math.abs(ah.h - hsl.h));
    if (d < bd) { bd = d; best = a.id; }
  }
  return best;
}

// ---------- ブロック：1〜2枚の写真で1〜2コマを作る ----------
// ctx … { FH, cell, margin（余白のグリッド数）, side（'left' | 'right'）, top, bottom（使える縦の範囲） }
// 返り値 … { frames, items: [{ photo, rect（ブロック先頭コマからの台紙px） }] }

// 写真の縦横比に合わせた大きさ（幅 w を基準に、高さが範囲に収まらなければ縮める）
function fitSize(ph, w, maxH, maxW) {
  let h = w / ratioOf(ph);
  if (h > maxH) { h = maxH; w = h * ratioOf(ph); }
  if (w > maxW) { w = maxW; h = w / ratioOf(ph); }
  return { w, h };
}

const BLOCKS = {
  full: { photos: 1, frames: 1, ok: () => true,
    make: (ps) => [{ photo: ps[0], rect: { x: 0, y: 0, w: FW, h: frameH() } }] },

  pano: { photos: 1, frames: 2, ok: ps => isLand(ps[0]),
    make: (ps) => [{ photo: ps[0], rect: { x: 0, y: 0, w: FW * 2, h: frameH() } }] },

  // 余白のある1枚。中央やや上・左下・右上のどれか
  framed: { photos: 1, frames: 1, ok: () => true,
    make: (ps, c) => {
      const ph = ps[0], m = c.margin * c.cell.w;
      const variant = pickWeighted([{ v: 'center', w: 2 }, { v: 'low', w: 1.5 }, { v: 'high', w: 1.2 }]).v;
      const usableH = c.bottom - c.top;
      const s = fitSize(ph, FW * (variant === 'center' ? rnd(0.72, 0.86) : rnd(0.6, 0.74)), usableH * 0.78, FW - m * 2);
      let x, y;
      if (variant === 'center') { x = (FW - s.w) / 2; y = c.top + (usableH - s.h) * 0.42; }
      else if (variant === 'low') { x = c.side === 'left' ? m : FW - m - s.w; y = c.bottom - m * 1.5 - s.h; }
      else { x = c.side === 'left' ? FW - m - s.w : m; y = c.top + m * 1.5; }
      return [{ photo: ph, rect: { x, y, w: s.w, h: s.h } }];
    } },

  // 2枚を上下に（横長どうし）。ぴったり付けるか、細い余白を挟む
  split: { photos: 2, frames: 1, ok: ps => isLand(ps[0]) && isLand(ps[1]),
    make: (ps, c) => {
      const H = frameH();
      if (Math.random() < 0.5) {
        return [{ photo: ps[0], rect: { x: 0, y: 0, w: FW, h: H / 2 } }, { photo: ps[1], rect: { x: 0, y: H / 2, w: FW, h: H / 2 } }];
      }
      const m = c.margin * c.cell.w, g = c.cell.h, h = (c.bottom - c.top - m * 2 - g) / 2;
      return [{ photo: ps[0], rect: { x: m, y: c.top + m, w: FW - m * 2, h } },
              { photo: ps[1], rect: { x: m, y: c.top + m + h + g, w: FW - m * 2, h } }];
    } },

  // 2枚を対角にずらして（上の1枚は寄せる側、下の1枚は反対側）
  duo: { photos: 2, frames: 1, ok: () => true,
    make: (ps, c) => {
      const m = c.margin * c.cell.w, usableH = c.bottom - c.top;
      let k = 1;
      for (let t = 0; t < 12; t++) {
        const a = fitSize(ps[0], FW * 0.56 * k, usableH * 0.5 * k, FW - m * 2);
        const b = fitSize(ps[1], FW * 0.56 * k, usableH * 0.5 * k, FW - m * 2);
        const ra = { x: c.side === 'left' ? m : FW - m - a.w, y: c.top + m, w: a.w, h: a.h };
        const rb = { x: c.side === 'left' ? FW - m - b.w : m, y: c.bottom - m - b.h, w: b.w, h: b.h };
        if (!rectsOverlap(expandRect(ra, c.cell.w / 2), rb)) return [{ photo: ps[0], rect: ra }, { photo: ps[1], rect: rb }];
        k *= 0.92;
      }
      return null;
    } },

  // 2コマ：1枚目は1コマ目に余白を取って置き、2枚目はコマの境目をまたぐ（めくると続きが見える）
  bridge: { photos: 2, frames: 2, ok: () => true,
    make: (ps, c) => {
      const m = c.margin * c.cell.w, usableH = c.bottom - c.top;
      const a = fitSize(ps[0], FW * 0.46, usableH * 0.6, FW * 0.5 - m);
      const b = fitSize(ps[1], FW * rnd(0.95, 1.1), usableH * 0.7, FW * 1.2);
      const ra = { x: m, y: c.bottom - m * 2 - a.h, w: a.w, h: a.h };
      const bx = Math.max(ra.x + ra.w + c.cell.w * 2, FW - b.w * rnd(0.4, 0.55));
      const rb = { x: bx, y: c.top + m * 1.5, w: b.w, h: b.h };
      if (rb.x + rb.w > FW * 2 - m) return null;
      return [{ photo: ps[0], rect: ra }, { photo: ps[1], rect: rb }];
    } },
};

// ---------- 組み上げ ----------

function autoLayout(photos) {
  const H = frameH(), asp = aspectById(currentAspectId());
  const ctx = {
    cell: gridCell(),
    margin: Math.random() < 0.6 ? 1 : 2,
    side: Math.random() < 0.5 ? 'left' : 'right',
    top: asp.safeTop || 0,
    bottom: H - (asp.safeBottom || 0),
  };
  const blocks = [];
  let i = 0, frames = 0, prev = null, prev2 = null;
  while (i < photos.length) {
    const left = photos.length - i;
    const cands = [];
    for (const [type, b] of Object.entries(BLOCKS)) {
      if (b.photos > left) continue;
      // 残りの写真を最低1コマずつ置ける余地を残す
      const restPhotos = left - b.photos;
      if (frames + b.frames + Math.ceil(restPhotos / 2) > AUTO.MAX_FRAMES) continue;
      const ps = photos.slice(i, i + b.photos);
      if (!b.ok(ps)) continue;
      let w = AUTO.WEIGHTS[type];
      if (i === 0) w *= type === 'full' || type === 'pano' ? 2.5 : type === 'framed' ? 1 : 0.3; // 表紙は強く
      if (type === prev) w *= AUTO.REPEAT_PENALTY;
      if (type === prev2) w *= 0.6;
      if (prev && BLEED_TYPES.has(prev) !== BLEED_TYPES.has(type)) w *= AUTO.RHYTHM_BONUS;
      if (BLEED_TYPES.has(prev) && BLEED_TYPES.has(prev2) && BLEED_TYPES.has(type)) w *= AUTO.BLEED_RUN_PENALTY;
      if (type === 'framed' && isPort(ps[0]) && asp.id === 'feed') w *= 0.8;  // 縦長はフィードでは全面が映える
      if (type === 'full' && isLand(ps[0])) w *= 0.6;                         // 横長の全面は切り取りが大きい
      cands.push({ type, w, ps });
    }
    let made = null, pick;
    if (!cands.length) cands.push({ type: 'full', w: 1, ps: [photos[i]] });
    for (let t = 0; t < 6 && !made; t++) {
      pick = pickWeighted(cands);
      made = BLOCKS[pick.type].make(pick.ps, ctx);
    }
    if (!made) { pick = { type: 'full', ps: [photos[i]] }; made = BLOCKS.full.make(pick.ps, ctx); }
    blocks.push({ frame: frames, type: pick.type, items: made });
    frames += BLOCKS[pick.type].frames;
    i += BLOCKS[pick.type].photos;
    prev2 = prev; prev = pick.type;
    // ブロックごとに寄せる側を入れ替えて、左右の揺れを作る
    if (Math.random() < 0.7) ctx.side = ctx.side === 'left' ? 'right' : 'left';
  }

  const post = createPost(Math.max(1, frames));
  const hsl = photoHsl(photos);
  const bg = pickWeighted(AUTO.BACKGROUNDS.map(b => ({ ...b }))).color(hsl);
  post.frameBg = Array(post.n).fill(bg);
  post.accent = pickAccent(hsl);
  for (const b of blocks) {
    for (const it of b.items) {
      const r = it.rect;
      const free = BLEED_TYPES.has(b.type) && r.w >= FW
        ? { x: b.frame * FW + r.x, y: r.y, w: r.w, h: r.h }               // 全面系はそのまま
        : snapRectToGrid({ x: b.frame * FW + r.x, y: r.y, w: r.w, h: r.h }); // 余白系はグリッドに揃える
      const win = makeWindow({ free, photo: photos.indexOf(it.photo) });
      if (b.type === 'full') win.cassette = 'full';
      if (b.type === 'pano') win.cassette = 'span2';
      post.parts.push(win);
    }
  }
  return post;
}
