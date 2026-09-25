// ============================================================
// スタイル：組み上がった状態（写真そのものは除く）を保存して、別の写真に当てはめる
//  ・保存先はこのブラウザの localStorage。写真の枚数ごとに分けて扱う
//  ・初期プリセット（js/presets.js の PRESETS）は別扱い。一覧には並ぶが削除できない
//  ・書き出し・読み込みは JSON。{ format, v, styles: [...] } の形
// ============================================================

const STYLE_KEY = 'carousel.styles.v1';
const STYLE_FORMAT = 'carousel-styles';

function newStyleId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// localStorage のスタイル。id の無い古いものには補う
function loadStyles() {
  try {
    const list = JSON.parse(localStorage.getItem(STYLE_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list.map(s => sanitizeStyle(s)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function saveStyles(list) {
  try {
    // id は端末の中で1件を見分けるのに使うので残す。preset だけ落とす
    localStorage.setItem(STYLE_KEY, JSON.stringify(list.map(({ preset, ...rest }) => rest)));
    return true;
  } catch (_) {
    return false;
  }
}

// 初期プリセット（削除できない）。presets.js が無くても動く
function presetStyles() {
  const src = typeof PRESETS !== 'undefined' ? PRESETS : [];
  return extractStyles(src).map((s, i) => ({ ...s, id: 'preset-' + i, preset: true }));
}

function allStyles() {
  return [...presetStyles(), ...loadStyles().sort((a, b) => b.createdAt - a.createdAt)];
}

// 写真の枚数が同じスタイルだけ（初期プリセット → 保存したものの新しい順）
function stylesFor(photoCount) {
  return allStyles().filter(s => s.photoCount === photoCount);
}

function addStyle(style) {
  const list = loadStyles();
  list.push({ ...style, id: style.id || newStyleId() });
  return saveStyles(list);
}

function removeStyle(id) {
  return saveStyles(loadStyles().filter(s => s.id !== id));
}

// ---------- 形の確認（読み込み・localStorage・プリセット共通） ----------

const num = v => typeof v === 'number' && isFinite(v);
const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

// 知っている項目だけを拾い、形が合わないものは null
function sanitizeStyle(s) {
  if (!s || typeof s !== 'object') return null;
  const n = s.n, pc = s.photoCount;
  if (!Number.isInteger(n) || n < 1 || n > CONFIG.GRID.MAX_FRAMES) return null;
  if (!Number.isInteger(pc) || pc < 1 || pc > CONFIG.PHOTO.MAX_COUNT) return null;
  if (!Array.isArray(s.frameBg) || s.frameBg.length !== n || !s.frameBg.every(isHex)) return null;
  if (!Array.isArray(s.windows)) return null;
  const modes = CONFIG.TONE.modes.map(m => m.id), strengths = CONFIG.TONE.strengths.map(m => m.id);
  const windows = [];
  for (const w of s.windows) {
    const f = w && w.free;
    if (!f || ![f.x, f.y, f.w, f.h].every(num) || f.w <= 0 || f.h <= 0) return null;
    if (!Number.isInteger(w.photo) || w.photo < 0 || w.photo >= pc) return null;
    const tone = w.tone || {};
    windows.push({
      photo: w.photo,
      free: { x: f.x, y: f.y, w: f.w, h: f.h },
      cassette: typeof w.cassette === 'string' && CASSETTES[w.cassette] ? w.cassette : null,
      clip: !!w.clip, border: !!w.border,
      zoom: num(w.zoom) ? clamp(w.zoom, CONFIG.ZOOM.MIN, CONFIG.ZOOM.MAX) : 1,
      offsetX: num(w.offsetX) ? w.offsetX : 0,
      offsetY: num(w.offsetY) ? w.offsetY : 0,
      tone: {
        mode: modes.includes(tone.mode) ? tone.mode : 'none',
        strength: strengths.includes(tone.strength) ? tone.strength : 'standard',
      },
    });
  }
  return {
    v: 1,
    id: typeof s.id === 'string' ? s.id : (num(s.createdAt) ? 'c' + s.createdAt : newStyleId()),
    name: (typeof s.name === 'string' && s.name.trim() ? s.name.trim() : '名前なし').slice(0, 60),
    photoCount: pc,
    createdAt: num(s.createdAt) ? s.createdAt : Date.now(),
    n, accent: CONFIG.ACCENTS.some(a => a.id === s.accent) ? s.accent : CONFIG.ACCENT_DEFAULT,
    frameBg: [...s.frameBg], windows,
  };
}

// 書き出しの包み・スタイルの配列・スタイル単体のどれからでもスタイルを取り出す
function extractStyles(data) {
  if (Array.isArray(data)) return data.flatMap(extractStyles);
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.styles)) return data.styles.flatMap(extractStyles);
  const s = sanitizeStyle(data);
  return s ? [s] : [];
}

// 書き出しに含めない項目（id と preset は、この端末の中だけで使う）
function stripRuntime(s) {
  const { id, preset, ...rest } = s;
  return rest;
}

// ---------- 書き出し・読み込み ----------

function exportStylesJson(styles) {
  return JSON.stringify({
    format: STYLE_FORMAT, v: 1, exportedAt: new Date().toISOString(),
    styles: styles.map(stripRuntime),
  }, null, 2);
}

// 同じ名前があれば末尾に番号を付ける（「夏」→「夏 2」→「夏 3」）
function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const base = name.replace(/ \d+$/, '');
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// JSON文字列を読み込んで、今あるスタイルに追加する（既存は消さない）
// 返り値：{ added: [名前], error }
function importStylesJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return { added: [], error: 'JSONとして読めませんでした。書き出した文字列を、はじめから終わりまでそのまま貼り付けてください。' };
  }
  const found = extractStyles(data);
  if (!found.length) return { added: [], error: 'スタイルが見つかりませんでした（形式が違うか、中身が壊れています）。' };
  const list = loadStyles();
  const taken = new Set(allStyles().map(s => s.name));
  const added = [];
  const now = Date.now();
  found.forEach((s, i) => {
    const name = uniqueName(s.name, taken);
    taken.add(name);
    list.push({ ...s, name, id: newStyleId(), createdAt: now + i });
    added.push(name);
  });
  if (!saveStyles(list)) return { added: [], error: '保存できませんでした（このブラウザでは保存領域が使えない可能性があります）。' };
  return { added };
}

// 配置図のサムネイル：コマの背景色の上に、写真を線画の枠で描く（単色系は基調色で塗る）
function styleThumb(style) {
  const NS = 'http://www.w3.org/2000/svg';
  const FW = CONFIG.GRID.FRAME_W, FH = CONFIG.GRID.FRAME_H;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${FW * style.n} ${FH}`);
  const add = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.appendChild(e);
    return e;
  };
  style.frameBg.forEach((c, f) => add('rect', { x: f * FW, y: 0, width: FW, height: FH, fill: c }));
  const accent = accentById(style.accent).photo;
  for (const w of style.windows) {
    const r = w.free;
    const tinted = w.tone && (w.tone.mode === 'duo' || w.tone.mode === 'paleDuo');
    const fill = tinted ? accent : (w.tone && w.tone.mode === 'pale' ? '#b9b9b9' : '#8f8f8f');
    const g = add('g', {});
    if (w.clip) {
      const id = 'c' + Math.random().toString(36).slice(2);
      const cp = document.createElementNS(NS, 'clipPath');
      cp.setAttribute('id', id);
      const f = Math.max(0, Math.floor((r.x + Math.min(r.w, FW) / 2) / FW));
      const cr = document.createElementNS(NS, 'rect');
      Object.entries({ x: f * FW, y: 0, width: FW, height: FH }).forEach(([k, v]) => cr.setAttribute(k, v));
      cp.appendChild(cr);
      svg.appendChild(cp);
      g.setAttribute('clip-path', `url(#${id})`);
    }
    const rect = document.createElementNS(NS, 'rect');
    Object.entries({ x: r.x, y: r.y, width: r.w, height: r.h, fill, 'fill-opacity': 0.85, stroke: '#222', 'stroke-width': 14 })
      .forEach(([k, v]) => rect.setAttribute(k, v));
    const no = document.createElementNS(NS, 'text');
    Object.entries({ x: r.x + 40, y: r.y + 150, 'font-size': 130, fill: '#fff', 'font-family': 'sans-serif' })
      .forEach(([k, v]) => no.setAttribute(k, v));
    no.textContent = w.photo + 1;
    g.appendChild(rect);
    g.appendChild(no);
  }
  for (let f = 1; f < style.n; f++) {
    add('line', { x1: f * FW, y1: 0, x2: f * FW, y2: FH, stroke: '#fc3', 'stroke-width': 12, 'stroke-dasharray': '50 35' });
  }
  return svg;
}
