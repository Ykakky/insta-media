// ============================================================
// 設定ブロック
// 色や数値はここだけを書き換えれば差し替わる。
// ============================================================
const CONFIG = {
  // 台紙とグリッド
  GRID: {
    FRAME_W: 1080,     // 1コマの幅
    FRAME_H: 1350,     // 1コマの高さ
    SNAP_COLS: 16,     // グリッド：1コマを横16×縦20の正方形に（1マス67.5px）
    SNAP_ROWS: 20,
    MIN_FRAMES: 1,
    MAX_FRAMES: 10,    // コマ数の上限（複数コマにわたる置き方で足すときも含む）
  },

  // 写真の読み込み
  PHOTO: {
    MAX_LONG_EDGE: 2800,
    MAX_COUNT: 10,     // プールに置ける写真の上限
  },

  // 書き出し
  EXPORT: {
    SCALE: 2,          // 1080×1350 → 2160×2700
    MIME: 'image/jpeg',
    QUALITY: 0.92,
  },

  // 窓の拡大率の範囲（1 = coverでちょうど埋まる大きさ）
  ZOOM: { MIN: 1, MAX: 5 },

  // 写真を窓より少し大きく描いて切り抜く量（台紙px）。縁の白線防止
  BLEED: 2,

  // 窓の白フチ
  BORDER: {
    width: 22,                     // 台紙px
    color: '#ffffff',
    shadowColor: 'rgba(0,0,0,0.28)',
    shadowBlur: 18,                // 台紙px
    shadowOffsetY: 6,              // 台紙px
  },

  // 編集操作
  EDIT: {
    MIN_FREE_SIZE: 80,   // 縮められる最小サイズ（台紙px）
    HANDLE_HIT: 26,      // つまみの当たり判定（画面css px）
    SNAP: 8,             // コマの端・グリッド線に吸着する距離（画面css px）
    TAP_SLOP: 8,         // これ以下の移動はタップ扱い（画面css px）
    LONG_PRESS_MS: 450,  // 長押しで「中の写真だけ動かす」に入るまでの時間
    BOARD_MAX_H: 0.52,   // 編集画面で台紙が使う高さの上限（画面の高さに対する割合）
    MIN_KEEP_W: 270,     // 複数コマの写真に押されたとき、隣の写真を「狭める」で済ませる最小の残り幅（台紙px）。
                         // これより狭くなるなら、隣の写真のコマから後ろを後ろへ送る
    HISTORY: 5,          // 「ひとつ戻る」で戻れる回数
    MINIMAP_SCALE: 1 / 3, // 縮小表示の縮小図の幅（画面幅に対する割合）
    MINIMAP_MIN_H: 28,   // 縮小図の最低の高さ（css px）。コマ数が多くても細くなりすぎないように
  },

  // 表示倍率：表示する幅（コマ数）
  VIEWS: [
    { id: 'normal', label: '通常', frames: 1 },
    { id: 'wide',   label: '縮小', frames: 2.5 },  // 下に全体の縮小図を出す
    { id: 'all',    label: '全体', frames: 0 },    // 0 = 全コマ
  ],

  // 基調色：投稿全体で1色。写真の色調（単色系）と文字色に使う。
  // 背景色・ベタの色とは独立（BG を参照）。
  //  photo … 写真に乗せる色（沈まないよう少し明るめ）
  //  ink   … 文字・罫線に使う色
  //  light … 淡い版（省略時は ink を白に ACCENT_LIGHT_MIX だけ混ぜて作る）
  ACCENTS: [
    { id: 'navy',   label: '濃紺',   photo: '#4b4f9e', ink: '#262a63' },
    { id: 'ai',     label: '藍',     photo: '#3f6b96', ink: '#1f3b5f' },
    { id: 'sky',    label: '水色',   photo: '#86c6e4', ink: '#3f8db3' },
    { id: 'teal',   label: '青緑',   photo: '#4d9c98', ink: '#1f6a68' },
    { id: 'forest', label: '深緑',   photo: '#4d7c5e', ink: '#1f4a34' },
    { id: 'leaf',   label: '若草',   photo: '#a6c46a', ink: '#6e8f2f' },
    { id: 'ochre',  label: '黄土',   photo: '#caa45a', ink: '#9c7427' },
    { id: 'sepia',  label: 'セピア', photo: '#a67c55', ink: '#6b4a2e' },
    { id: 'rust',   label: '赤茶',   photo: '#b8664a', ink: '#8a3b24' },
    { id: 'enji',   label: '臙脂',   photo: '#a04858', ink: '#6e1f2e' },
    { id: 'orange', label: '橙',     photo: '#ea9a58', ink: '#d0702a' },
    { id: 'violet', label: '紫',     photo: '#8c6cab', ink: '#5a3a78' },
    { id: 'gray',   label: '灰',     photo: '#8c8c8c', ink: '#555555' },
    { id: 'black',  label: '黒',     photo: '#3c3c3c', ink: '#111111' },
    { id: 'kinari', label: '生成り', photo: '#eadfc6', ink: '#cbbd9d', light: '#f5efe2' },
  ],
  ACCENT_DEFAULT: 'navy',
  ACCENT_LIGHT_MIX: 0.16,

  // 写真の色調（写真ごとに選ぶ）
  //  none     … そのまま
  //  pale     … 淡い：彩度を落とす（色は残す。基調色は乗せない）
  //  duo      … 単色：モノクロに基調色を乗せる。暗い側ほど基調色、明るい側は白へ
  //  paleDuo  … 淡い単色：単色の効きを弱めたもの
  //  強さは 弱・標準・強 の3段階。値はここで差し替える
  TONE: {
    modes: [
      { id: 'none',    label: 'そのまま' },
      { id: 'pale',    label: '淡い' },
      { id: 'duo',     label: '単色' },
      { id: 'paleDuo', label: '淡い単色' },
    ],
    strengths: [
      { id: 'weak',     label: '弱' },
      { id: 'standard', label: '標準' },
      { id: 'strong',   label: '強' },
    ],
    pale:    { weak: 0.3,  standard: 0.5,  strong: 0.7 },  // 彩度を落とす割合
    duo:     { weak: 0.65, standard: 0.85, strong: 1.0 },  // 基調色の効き
    paleDuo: { weak: 0.3,  standard: 0.42, strong: 0.55 },
    duoHighlight: 1.6,  // 大きいほど明るい側が早く白に抜ける

    // 第4段以降のトーン補正用（未使用）
    exposure: 0,
    contrast: 0,
    saturation: 0,
    shadowColor: '#000000',
    highlightColor: '#ffffff',
    strength: 'standard', // 'weak' | 'standard' | 'none'
    strengthValues: { weak: 0.5, standard: 1.0, none: 0 },
  },

  // 書体（文字入れ）
  //  書体は明朝・ゴシックの2種。無料で商用利用できる Web フォント（SIL Open Font License）。
  //  Google Fonts の CSS は unicode-range で分割配信され、使う文字を含む断片だけが読み込まれる。
  //  入力した文字列そのものは送らない。差し替えるときは families と fontCss を一緒に変える
  TYPE: {
    families: [
      { id: 'gothic', label: 'ゴシック', css: '"Noto Sans JP", "Hiragino Sans", sans-serif' },
      { id: 'mincho', label: '明朝',     css: '"Noto Serif JP", "Hiragino Mincho ProN", serif' },
    ],
    fontCss: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;700&family=Noto+Serif+JP:wght@300;700&display=swap',
    weights: [
      { id: 'normal', label: '通常', value: 300 },
      { id: 'bold',   label: '太字', value: 700 },
    ],
    roles: [                      // 級数（数値は台紙px。自由入力はさせない）
      { id: 'title', label: 'タイトル',   size: 64 },
      { id: 'sub',   label: 'サブコピー', size: 40 },
      { id: 'body',  label: '本文',       size: 30 },
    ],
    lineHeights: [                // 行間（級数に対する倍率）
      { id: 'tight',    label: '狭い', value: 1.35 },
      { id: 'standard', label: '標準', value: 1.6 },
      { id: 'loose',    label: '広い', value: 1.9 },
    ],
    letterSpacing: 0.04,          // em
    maxChars: 150,
    colors: [                     // 文字色：基調色・白・黒＋8色
      { id: 'accent',  label: '基調色' },
      { id: 'white',   label: '白' },
      { id: 'black',   label: '黒' },
      { id: '#d83a2e', label: '赤' },
      { id: '#ec6a2c', label: '朱' },
      { id: '#f2c230', label: '黄' },
      { id: '#3a8a4a', label: '緑' },
      { id: '#2f5fb3', label: '青' },
      { id: '#5bb8e0', label: '水色' },
      { id: '#e98aa8', label: '桃' },
      { id: '#8a8a8a', label: '灰' },
    ],
    defaultWidth: 0.8,            // 新しい文字の幅（コマ幅に対する割合）
  },

  // 背景色・ベタの色（基調色とは独立）。色見本＋色相・彩度・明度のスライダーで自由に作れる
  BG: {
    DEFAULT: '#ffffff',
    BETA_DEFAULT: '#1c1c1c',
    presets: [
      { label: '白',           color: '#ffffff' },
      { label: '生成り',       color: '#f3eee3' },
      { label: '薄灰',         color: '#e4e4e2' },
      { label: '灰',           color: '#8a8a8a' },
      { label: '黒',           color: '#111111' },
      { label: '紺',           color: '#1f2550' },
      { label: '蛍光イエロー', color: '#eaff00' },
      { label: '蛍光ピンク',   color: '#ff2e9a' },
      { label: '蛍光グリーン', color: '#2bff6a' },
      { label: '蛍光オレンジ', color: '#ff6a00' },
      { label: '蛍光ブルー',   color: '#00c8ff' },
    ],
  },
  WHITE: '#ffffff',
  BLACK: '#111111',
};

// ---------- 基調色から色を導く ----------

function accentById(id) {
  return CONFIG.ACCENTS.find(a => a.id === id) || CONFIG.ACCENTS[0];
}

// 投稿の基調色：{ photo, ink, light }。文字・罫線は ink を使う
function accentOf(post) {
  const a = accentById(post && post.accent);
  return { ...a, light: a.light || mixHex(a.ink, '#ffffff', 1 - CONFIG.ACCENT_LIGHT_MIX) };
}

// 色の指定 → 実際の色。'white' / 'black' / 'accent'（基調色の ink）か、#rrggbb
function resolveColor(c, post) {
  switch (c) {
    case 'white': return CONFIG.WHITE;
    case 'black': return CONFIG.BLACK;
    case 'accent': return accentOf(post).ink;
    default: return c;
  }
}

function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

// a と b を t（0〜1、1でb）で混ぜる
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

// 色相(0-360)・彩度(0-100)・明度(0-100) ⇄ #rrggbb（HSL）
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToHex([f(0), f(8), f(4)].map(v => v * 255));
}

function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
