// ============================================================
// コマ編集の操作欄：写真の色調・背景色・配置・カセット（常時表示）
// タブで切り替えず、1画面に並べる。カセットは画面下に常に並ぶ。
// ============================================================

// ---------- カセット（画面下に常時。タップで即適用） ----------

function renderCassetteDock() {
  const dock = $('cassette-dock');
  dock.innerHTML = '';
  const items = [];
  for (const [key, c] of Object.entries(CASSETTES)) for (const span of c.spans) items.push({ key, span, label: c.label });
  items.sort((a, b) => a.span - b.span);
  for (const it of items) {
    const fits = state.mode === 'free' || cassetteFitsGrid(it.key, it.span);
    const label = it.label + (it.span > 1 ? `（${it.span}コマ）` : '');
    const b = el('button', { className: 'cas', disabled: !fits, title: fits ? label : 'マス設計では使えません（写真が重なるため）' },
      [cassetteThumb(it.key, it.span), el('span', { textContent: label })]);
    b.addEventListener('click', () => {
      const res = applyCassette(state.post, state.frame, it.key, it.span, state.photos.length);
      if (res.error) { alert(res.error); return; }
      res.added.forEach(p => p.type === 'window' && fitWindow(p, state.photos));
      state.selected = null;
      pruneToneCache(state.post, state.photos);
      renderPool();
      updateEditorUI();
      editor.resize(); // コマ数が変わることがある
    });
    dock.appendChild(b);
  }
}

// カセットの形を線画のSVGで描く（build の結果をそのまま図にする）
function cassetteThumb(key, span) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = CONFIG.GRID.FRAME_W * span, H = CONFIG.GRID.FRAME_H;
  const { parts } = CASSETTES[key].build(0, span);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `-20 -20 ${W + 40} ${H + 40}`);
  const add = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.appendChild(e);
  };
  add('rect', { x: 0, y: 0, width: W, height: H, fill: '#2a2a2a', stroke: '#888', 'stroke-width': 10 });
  for (const p of parts) {
    const r = partRect(p);
    if (p.type === 'beta') {
      add('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: '#000', stroke: '#888', 'stroke-width': 10 });
      continue;
    }
    add('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: '#3d4d5c',
      stroke: p.border ? '#fff' : '#9cf', 'stroke-width': p.border ? 30 : 18 });
    add('path', { d: `M${r.x} ${r.y + r.h}L${r.x + r.w * 0.4} ${r.y + r.h * 0.45}L${r.x + r.w * 0.6} ${r.y + r.h * 0.7}L${r.x + r.w * 0.8} ${r.y + r.h * 0.5}L${r.x + r.w} ${r.y + r.h * 0.75}`,
      fill: 'none', stroke: '#9cf', 'stroke-width': 14 });
  }
  // コマの境目は最後に重ねる
  for (let i = 1; i < span; i++) {
    const x = i * CONFIG.GRID.FRAME_W;
    add('line', { x1: x, y1: -20, x2: x, y2: H + 20, stroke: '#fc3', 'stroke-width': 18, 'stroke-dasharray': '60 40' });
  }
  return svg;
}

// ---------- 写真の色調（写真ごと）と基調色（投稿全体） ----------

function renderTonePanel() {
  const post = state.post, s = state.selected;
  const win = s && s.type === 'window' ? s : null;
  const accent = accentOf(post);
  $('tone-title').textContent = win ? `写真の色調（写真${win.photo + 1}）` : '写真の色調 — 写真をタップして選択';

  const tc = $('tone-chips');
  tc.innerHTML = '';
  for (const m of CONFIG.TONE.modes) {
    const b = el('button', { className: win && win.tone.mode === m.id ? 'on' : '', disabled: !win });
    if (m.id === 'duo' || m.id === 'paleDuo') {
      const dot = el('span', { className: 'dot' });
      dot.style.background = m.id === 'duo' ? accent.photo : mixHex(accent.photo, '#ffffff', 0.5);
      b.append(dot);
    }
    b.append(m.label);
    b.addEventListener('click', () => setTone(win, { mode: m.id }));
    tc.appendChild(b);
  }
  const sc = $('strength-chips');
  sc.innerHTML = '';
  for (const st of CONFIG.TONE.strengths) {
    const off = !win || win.tone.mode === 'none';
    const b = el('button', { className: !off && win.tone.strength === st.id ? 'on' : '', disabled: off, textContent: '効き ' + st.label });
    b.addEventListener('click', () => setTone(win, { strength: st.id }));
    sc.appendChild(b);
  }
  $('tone-all').disabled = !win;

  const sw = $('accent-swatches');
  sw.innerHTML = '';
  for (const a of CONFIG.ACCENTS) {
    const b = el('button', { className: 'swatch' + (post.accent === a.id ? ' on' : ''), title: a.label, ariaLabel: a.label });
    b.style.background = `linear-gradient(135deg, ${a.photo} 0 50%, ${a.ink} 50% 100%)`;
    b.addEventListener('click', () => setAccent(a.id));
    sw.appendChild(b);
  }
}

// 基調色を変える：単色系の写真と、基調色の文字が一斉に変わる（背景色は変わらない）
function setAccent(id) {
  state.post.accent = id;
  pruneToneCache(state.post, state.photos);
  renderTonePanel();
  editor.requestDraw();
}

function setTone(win, patch) {
  if (!win) return;
  win.tone = { ...win.tone, ...patch };
  pruneToneCache(state.post, state.photos);
  renderTonePanel();
  editor.requestDraw();
}

function applyToneToAll() {
  const win = state.selected;
  if (!win || win.type !== 'window') return;
  for (const p of state.post.parts) if (p.type === 'window') p.tone = { ...win.tone };
  pruneToneCache(state.post, state.photos);
  renderTonePanel();
  editor.requestDraw();
}

// ---------- 背景色（基調色とは独立。色見本＋色相・彩度・明度） ----------
// 対象：ベタを選んでいればそのベタ、なければ選択中のコマの背景

function bgTarget() {
  const s = state.selected;
  if (s && s.type === 'beta') return { get: () => s.color, set: c => { s.color = c; }, label: 'ベタの色' };
  const f = state.frame, post = state.post;
  return { get: () => post.frameBg[f], set: c => { post.frameBg[f] = c; }, label: `背景色（コマ${f + 1}）` };
}

function renderBgPanel(fromSlider) {
  const t = bgTarget(), cur = t.get().toLowerCase();
  $('bg-title').textContent = t.label;
  const sw = $('bg-swatches');
  sw.innerHTML = '';
  const presets = [...CONFIG.BG.presets, { label: '基調色', color: accentOf(state.post).ink }];
  for (const p of presets) {
    const b = el('button', { className: 'swatch' + (p.color.toLowerCase() === cur ? ' on' : ''), title: p.label, ariaLabel: p.label });
    b.style.background = p.color;
    b.addEventListener('click', () => setBg(p.color));
    sw.appendChild(b);
  }
  $('bg-hex').textContent = cur;
  if (!fromSlider) {
    const hsl = hexToHsl(cur);
    $('bg-h').value = hsl.h; $('bg-s').value = hsl.s; $('bg-l').value = hsl.l;
  }
  // スライダーの帯に、今の色から作れる範囲を描く
  const h = +$('bg-h').value, s = +$('bg-s').value, l = +$('bg-l').value;
  $('bg-h').style.background = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map(x => hslToHex(x, Math.max(s, 60), 50)).join(',')})`;
  $('bg-s').style.background = `linear-gradient(90deg, ${hslToHex(h, 0, l)}, ${hslToHex(h, 100, l)})`;
  $('bg-l').style.background = `linear-gradient(90deg, #000, ${hslToHex(h, s, 50)}, #fff)`;
}

function setBg(color, fromSlider) {
  bgTarget().set(color);
  renderBgPanel(fromSlider);
  editor.requestDraw();
}

// ---------- 配置 ----------

function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === 'grid') {
    const drop = snapAllToGrid(state.post, true);
    if (drop.length && !confirm(`マスに合わせると重なる写真が${drop.length}枚あります。外してマス設計にしますか？`)) return;
    snapAllToGrid(state.post);
    state.post.parts.forEach(p => {
      if (p.type !== 'window') return;
      if (p.align) fitWindow(p, state.photos);
      else if (state.photos[p.photo]) clampWindow(p, state.photos[p.photo]);
    });
    if (state.selected && !state.post.parts.includes(state.selected)) state.selected = null;
    pruneToneCache(state.post, state.photos);
    renderPool();
  }
  state.mode = mode;
  renderCassetteDock();
  updateEditorUI();
  editor.requestDraw();
}

// 「写真を置く」：選択中のコマに1マス分
function addWindowButton() {
  const f = state.frame, C = CONFIG.GRID.COLS;
  if (state.mode === 'grid') {
    for (let row = 0; row < CONFIG.GRID.ROWS; row++)
      for (let col = f * C; col < (f + 1) * C; col++) {
        const span = { col, row, cols: 1, rows: 1 };
        if (!gridBlocked(state.post, span, null)) { addWindow(span); return; }
      }
    alert('このコマに空いているマスがありません。');
    return;
  }
  const c = cellSize(), fr = frameRect(f);
  addWindow({ free: roundRect({ x: fr.x + (fr.w - c.w) / 2, y: (fr.h - c.h) / 2, w: c.w, h: c.h }) });
}

function addFrameButton() {
  const added = addFrameAfter(state.post, state.frame, state.photos.length);
  if (!added.length) { alert(`コマは${CONFIG.GRID.MAX_FRAMES}コマまでです。`); return; }
  added.forEach(p => p.type === 'window' && fitWindow(p, state.photos));
  goFrame(state.frame + 1);
  renderPool();
}

function deleteFrameButton() {
  if (state.post.n <= CONFIG.GRID.MIN_FRAMES) return;
  if (!confirm(`コマ${state.frame + 1}を削除しますか？（このコマの写真・ベタ・文字も消えます）`)) return;
  const added = deleteFrame(state.post, state.frame, state.photos.length);
  added.forEach(p => p.type === 'window' && fitWindow(p, state.photos));
  pruneToneCache(state.post, state.photos);
  goFrame(Math.min(state.frame, state.post.n - 1));
  renderPool();
}

// ---------- 表示の更新・初期化 ----------

function renderLayoutPanels() {
  const s = state.selected, n = state.post.n;
  renderTonePanel();
  renderBgPanel();
  document.querySelectorAll('#mode-seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  $('add-frame').disabled = n >= CONFIG.GRID.MAX_FRAMES;
  $('del-frame').disabled = n <= CONFIG.GRID.MIN_FRAMES;
  $('del-part').disabled = !s;
  $('to-front').disabled = !s || state.mode === 'grid';
}

function initLayoutPanels() {
  renderCassetteDock();
  document.querySelectorAll('#mode-seg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('add-window').addEventListener('click', addWindowButton);
  $('to-front').addEventListener('click', bringToFront);
  $('del-part').addEventListener('click', deleteSelected);
  $('add-frame').addEventListener('click', addFrameButton);
  $('del-frame').addEventListener('click', deleteFrameButton);
  $('tone-all').addEventListener('click', applyToneToAll);
  $('shuffle-btn').addEventListener('click', () => {
    shufflePhotos(state.post, state.photos.length).forEach(w => fitWindow(w, state.photos));
    pruneToneCache(state.post, state.photos);
    renderPool();
    updateEditorUI();
    editor.requestDraw();
  });
  for (const id of ['bg-h', 'bg-s', 'bg-l']) {
    $(id).addEventListener('input', () => setBg(hslToHex(+$('bg-h').value, +$('bg-s').value, +$('bg-l').value), true));
  }
  $('bg-all').addEventListener('click', () => {
    const c = bgTarget().get();
    state.post.frameBg = state.post.frameBg.map(() => c);
    editor.requestDraw();
  });
}
