// ============================================================
// UI：画面の流れ・写真の並べ替え・編集画面の共通操作・書き出し
//  流れ：写真を選んで並べる → この順で組む → 編集（配置・色調・背景・文字・グリッド）→ 書き出し
//  ツールボックスの中身は panels.js（配置・色調・背景・グリッド）と textui.js（文字）
//  スタイルの保存は styles.js、プレビューは preview.js、台紙の上での指の操作は editor.js
// ============================================================

const state = {
  photos: [],       // loadPhoto の結果（＋thumb）。並び順＝組むときのコマ順
  post: null,
  tool: 'layout',   // ツールボックス：'layout' | 'tone' | 'bg' | 'text' | 'grid'
  grid: false,      // グリッドを表示（表示中はグリッド線に吸着）
  frame: 0,         // 表示中のコマ
  selected: null,   // 選択中の部品（窓・ベタ・文字）。画面上は窓を「写真」と呼ぶ
  poolPick: null,   // プールで持っている写真の番号
  exportBlobs: [],
  exportUrls: [],
};

const $ = id => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

// ---------- 段階の移動 ----------

// step: 'photos' | 'edit' | 'export'
function goStep(step) {
  if (step !== 'photos' && !state.post) return;
  dropEmptyText();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + (step === 'edit' ? 'editor' : step)).classList.add('active');
  document.body.classList.toggle('editing', step === 'edit');
  document.querySelectorAll('#steps [data-step]').forEach(b => {
    b.classList.toggle('on', b.dataset.step === step);
    b.disabled = b.dataset.step !== 'photos' && !state.post;
  });
  $('preview-btn').disabled = !state.post;
  window.scrollTo(0, 0);
  if (step === 'photos') renderOrderGrid();
  if (step === 'edit') {
    state.selected = null;
    state.poolPick = null;
    updateEditorUI();
    editor.resize();
  }
  if (step === 'export') runExport();
}

// ---------- 1. 写真を選んで並べる ----------

async function loadInto(files, log) {
  const loaded = [];
  for (const f of files) {
    if (log) appendLog(log, `読み込み中: ${f.name}`);
    try {
      const p = await loadPhoto(f);
      p.thumb = makeThumb(p);
      loaded.push(p);
      if (log) appendLog(log, p.info);
    } catch (err) {
      if (log) appendLog(log, `✕ ${f.name}\n${err.message}`, true);
      else alert(`${f.name} を読み込めませんでした\n${err.message}`);
    }
  }
  return loaded;
}

function makeThumb(photo) {
  const s = 160, c = document.createElement('canvas');
  c.width = c.height = s;
  const k = Math.max(s / photo.w, s / photo.h);
  c.getContext('2d').drawImage(photo.canvas, (s - photo.w * k) / 2, (s - photo.h * k) / 2, photo.w * k, photo.h * k);
  return c.toDataURL('image/jpeg', 0.8);
}

function appendLog(elm, text, isErr) {
  const div = el('div', { textContent: text });
  if (isErr) div.className = 'err';
  elm.appendChild(div);
}

// 写真の並びを変える。order[新しい位置] = 旧番号。組んだ後なら台紙の写真も付け替える
function reorderPhotos(order) {
  const map = [];
  order.forEach((oldIdx, newIdx) => { map[oldIdx] = newIdx; });
  state.photos = order.map(i => state.photos[i]);
  if (state.post) remapPhotos(state.post, map, state.photos.length);
  renderOrderGrid();
}

function removePhoto(idx) {
  const order = state.photos.map((_, i) => i).filter(i => i !== idx);
  const map = state.photos.map((_, i) => (i === idx ? -1 : order.indexOf(i)));
  state.photos = order.map(i => state.photos[i]);
  if (state.post) {
    const lost = remapPhotos(state.post, map, state.photos.length);
    lost.forEach(p => fitWindow(p, state.photos));
    pruneToneCache(state.post, state.photos);
  }
  renderOrderGrid();
}

// 並べ替え：サムネイルをドラッグして、落とした位置へ差し込む
function renderOrderGrid() {
  const grid = $('order-grid');
  grid.innerHTML = '';
  state.photos.forEach((ph, i) => {
    const cell = el('div', { className: 'order-cell' }, [
      el('img', { src: ph.thumb, alt: `写真${i + 1}`, draggable: false }),
      el('span', { className: 'order-no', textContent: i + 1 }),
    ]);
    const del = el('button', { className: 'order-del', textContent: '×', ariaLabel: `写真${i + 1}を外す` });
    del.addEventListener('click', e => { e.stopPropagation(); removePhoto(i); });
    cell.appendChild(del);
    attachReorderDrag(cell, i);
    grid.appendChild(cell);
  });
  const n = state.photos.length;
  $('build-btn').disabled = n < 1;
  $('build-btn').textContent = state.post ? 'この順で組み直す' : 'この順で組む';
  $('back-to-edit').hidden = !state.post || n < 1;
  renderPhotoStyles();
}

// 写真画面にも、同じ枚数のスタイルを並べる（タップでそのスタイルで組む）
function renderPhotoStyles() {
  const n = state.photos.length, list = n ? stylesFor(n) : [];
  $('photo-styles-box').hidden = !list.length;
  $('photo-styles-label').textContent = `保存したスタイルで組む（${n}枚用）`;
  renderStyleRow($('photo-styles'), list, false);
}

function attachReorderDrag(cell, idx) {
  let start = null, dragging = false;
  cell.addEventListener('pointerdown', e => {
    if (e.target.closest('.order-del')) return;
    start = { x: e.clientX, y: e.clientY };
    try { cell.setPointerCapture(e.pointerId); } catch (_) {}
  });
  cell.addEventListener('pointermove', e => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!dragging && Math.hypot(dx, dy) > CONFIG.EDIT.TAP_SLOP) { dragging = true; cell.classList.add('dragging'); }
    if (dragging) cell.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
  });
  const end = e => {
    if (!start) return;
    const was = dragging;
    start = null; dragging = false;
    cell.classList.remove('dragging');
    cell.style.transform = '';
    if (!was) return;
    const to = orderIndexAt(e.clientX, e.clientY);
    if (to == null || to === idx) return;
    const order = state.photos.map((_, i) => i);
    order.splice(idx, 1);
    order.splice(to, 0, idx);
    reorderPhotos(order);
  };
  cell.addEventListener('pointerup', end);
  cell.addEventListener('pointercancel', end);
}

// 指の位置に一番近いマスの番号
function orderIndexAt(x, y) {
  const cells = [...$('order-grid').querySelectorAll('.order-cell')];
  let best = null, bd = Infinity;
  cells.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// 新しい投稿で編集を始める
function startWithPost(post) {
  state.post = post;
  state.post.parts.forEach(p => p.type === 'window' && state.photos[p.photo] && clampWindow(p, state.photos[p.photo]));
  pruneToneCache(state.post, state.photos);
  Object.assign(state, { frame: 0, tool: 'layout' });
  goStep('edit');
}

function initPhotosScreen() {
  const log = $('load-log');
  $('file-input').addEventListener('change', async e => {
    const room = CONFIG.PHOTO.MAX_COUNT - state.photos.length;
    let files = Array.from(e.target.files || []);
    e.target.value = '';
    log.innerHTML = '';
    if (files.length > room) {
      appendLog(log, `写真は${CONFIG.PHOTO.MAX_COUNT}枚までです。先頭${room}枚だけ追加します。`, true);
      files = files.slice(0, room);
    }
    state.photos.push(...await loadInto(files, log));
    renderOrderGrid();
  });

  $('build-btn').addEventListener('click', () => {
    if (state.post && !confirm('この順で組み直すと、今の配置と文字は消えます。よろしいですか？')) return;
    const accent = state.post ? state.post.accent : CONFIG.ACCENT_DEFAULT;
    const post = buildFromPhotos(Math.min(state.photos.length, CONFIG.GRID.MAX_FRAMES));
    post.accent = accent;
    post.parts.forEach(p => fitWindow(p, state.photos));
    startWithPost(post);
  });
  $('back-to-edit').addEventListener('click', () => goStep('edit'));
}

// ---------- 編集画面：選択と部品の操作（editor.js からも呼ぶ） ----------

function select(part, p) {
  if (state.selected !== part) dropEmptyText();
  if (p) state.frame = frameAt(state.post.n, p.x);
  state.selected = part || null;
  updateEditorUI();
  editor.requestDraw();
}

// 何も入力されないまま選択が外れた文字は片付ける
function dropEmptyText() {
  const s = state.selected;
  if (s && s.type === 'text' && !s.text.trim()) state.post.parts = state.post.parts.filter(p => p !== s);
}

function putPhoto(win, idx) {
  win.photo = idx;
  fitWindow(win, state.photos);
  pruneToneCache(state.post, state.photos);
  renderPool();
  editor.requestDraw();
}

// 表示中のコマに写真を1枚置く（持っている写真か、使われていない写真。置き方は「小・中央」）
function addPhotoHere() {
  const win = makeWindow({ free: { x: 0, y: 0, w: 1, h: 1 } });
  win.photo = state.poolPick != null ? state.poolPick : leastUsedPhoto(state.post, state.photos.length);
  applyCassette(state.post, win, state.frame, 'smallCenter');
  state.post.parts.push(win);
  fitWindow(win, state.photos);
  state.poolPick = null;
  select(win);
  renderPool();
}

function onEditChanged() {
  updateEditorUI();
  editor.requestDraw();
}

function deleteSelected() {
  const s = state.selected;
  if (!s) return;
  state.post.parts = state.post.parts.filter(p => p !== s);
  state.selected = null;
  pruneToneCache(state.post, state.photos);
  renderPool();
  updateEditorUI();
  editor.requestDraw();
}

function bringToFront() {
  const s = state.selected;
  if (!s) return;
  state.post.parts = state.post.parts.filter(p => p !== s);
  state.post.parts.push(s);
  editor.requestDraw();
}

function goFrame(f) {
  dropEmptyText();
  state.frame = clamp(f, 0, state.post.n - 1);
  state.selected = null;
  updateEditorUI();
  editor.resize();
}

// ---------- 編集画面：表示の更新 ----------

function updateEditorUI() {
  if (!state.post) return;
  const s = state.selected, n = state.post.n;
  $('frame-prev').disabled = state.frame <= 0;
  $('frame-next').disabled = state.frame >= n - 1;
  let info = `${state.frame + 1} / ${n}`;
  if (state.poolPick != null) info += `・写真${state.poolPick + 1}を持っています`;
  else if (s) info += { window: `・写真${s.photo + 1}`, beta: '・ベタ', text: '・文字' }[s.type];
  $('sel-info').textContent = info;

  document.querySelectorAll('#tool-icons button').forEach(b => b.classList.toggle('on', b.dataset.tool === state.tool));
  document.querySelectorAll('#toolbox > [data-tool]').forEach(d => { d.hidden = d.dataset.tool !== state.tool; });
  if (state.tool === 'text') renderTextPanel();
  else renderToolbox();
}

function setTool(tool) {
  if (tool === state.tool) return;
  dropEmptyText();
  // 文字ツールと写真のツールでは、触れる対象が違うので選択を外す
  const toText = tool === 'text', fromText = state.tool === 'text';
  if (toText !== fromText) state.selected = null;
  state.tool = tool;
  state.poolPick = null;
  $('toolbox').scrollTop = 0;
  updateEditorUI();
  editor.requestDraw();
}

function initEditorScreen() {
  editor.init();
  $('frame-prev').addEventListener('click', () => goFrame(state.frame - 1));
  $('frame-next').addEventListener('click', () => goFrame(state.frame + 1));
  document.querySelectorAll('#tool-icons button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('pool-input').addEventListener('change', async e => {
    const room = CONFIG.PHOTO.MAX_COUNT - state.photos.length;
    const files = Array.from(e.target.files || []).slice(0, room);
    e.target.value = '';
    state.photos.push(...await loadInto(files, null));
    renderPool();
  });
}

// ---------- 3. 書き出し ----------

async function runExport() {
  const list = $('export-list');
  state.exportUrls.forEach(u => URL.revokeObjectURL(u));
  state.exportUrls = [];
  state.exportBlobs = [];
  list.innerHTML = '<p class="hint">書き出し中…</p>';
  await ensureFonts(state.post);

  const items = [];
  for (let i = 0; i < state.post.n; i++) {
    try {
      const blob = await exportFrame(state.post, state.photos, i);
      const url = URL.createObjectURL(blob);
      state.exportBlobs.push(blob);
      state.exportUrls.push(url);
      items.push({ i, blob, url });
    } catch (err) {
      items.push({ i, error: err.message });
    }
  }

  list.innerHTML = '';
  for (const it of items) {
    const name = `carousel_${String(it.i + 1).padStart(2, '0')}.jpg`;
    const cap = el('div', { className: 'cap' });
    if (it.error) {
      cap.textContent = `${it.i + 1}枚目: 失敗 ${it.error}`;
      list.appendChild(cap);
      continue;
    }
    cap.textContent = `${it.i + 1} / ${state.post.n}  ${(it.blob.size / 1024).toFixed(0)}KB  `;
    // download属性の挙動確認用リンク（iOSでは期待どおりにならない場合がある）
    cap.appendChild(el('a', { href: it.url, download: name, textContent: 'download属性で保存' }));
    list.appendChild(cap);
    list.appendChild(el('img', { src: it.url, alt: name }));
  }
  $('share-btn').disabled = !(navigator.canShare &&
    navigator.canShare({ files: [new File([new Blob()], 'x.jpg', { type: 'image/jpeg' })] }));
}

function initExportScreen() {
  $('export-back').addEventListener('click', () => goStep('edit'));
  // 共有シート（「画像を保存」でまとめて写真アプリへ）
  $('share-btn').addEventListener('click', async () => {
    const files = state.exportBlobs.map((b, i) =>
      new File([b], `carousel_${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
    try {
      await navigator.share({ files });
    } catch (err) {
      if (err.name !== 'AbortError') alert('共有できませんでした: ' + err.message);
    }
  });
}

// ---------- 起動 ----------

function startApp() {
  document.querySelectorAll('#steps [data-step]').forEach(b => b.addEventListener('click', () => goStep(b.dataset.step)));
  $('preview-btn').addEventListener('click', () => { dropEmptyText(); openPreview(); });
  // フォントが届いたら字幅を測り直して描き直す
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => { clearTextLayout(); editor.requestDraw(); });
  initPhotosScreen();
  initEditorScreen();
  initToolbox();
  initStyleSheet();
  initTextPanel();
  initPreview();
  initExportScreen();
  goStep('photos');
}
