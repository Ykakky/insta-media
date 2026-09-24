// ============================================================
// UI：画面の流れ・写真の並べ替え・編集画面の共通操作・書き出し
//  流れ：写真を選んで並べる → この順で組む → コマ編集 → 文字入れ → 書き出し
//  コマ編集の操作欄は panels.js、文字入れは textui.js、プレビューは preview.js
//  台紙の上での指の操作は editor.js
// ============================================================

const state = {
  photos: [],       // loadPhoto の結果（＋thumb）。並び順＝組むときのコマ順
  post: null,
  stage: 'layout',  // 編集画面の段階：'layout' コマ編集 | 'text' 文字入れ
  mode: 'free',     // 'free' 自由設計 | 'grid' マス設計
  frame: 0,         // 選択中のコマ
  selected: null,   // 選択中の部品（窓・ベタ・文字）。画面上は窓を「写真」と呼ぶ
  poolPick: null,   // プールで選んでいる写真の番号
  zoom: true,       // 拡大表示（1コマを画面幅いっぱいに）
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

// step: 'photos' | 'layout' | 'text' | 'export'
function goStep(step) {
  if (step !== 'photos' && !state.post) return;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = step === 'photos' ? 'photos' : step === 'export' ? 'export' : 'editor';
  $('screen-' + screen).classList.add('active');
  document.querySelectorAll('#steps button').forEach(b => {
    b.classList.toggle('on', b.dataset.step === step);
    b.disabled = b.dataset.step !== 'photos' && !state.post;
  });
  window.scrollTo(0, 0);
  if (step === 'photos') renderOrderGrid();
  if (step === 'layout' || step === 'text') enterStage(step);
  if (step === 'export') runExport();
}

function enterStage(stage) {
  dropEmptyText();
  state.stage = stage;
  state.selected = null;
  state.poolPick = null;
  document.querySelectorAll('#screen-editor [data-stage]').forEach(e => { e.hidden = e.dataset.stage !== stage; });
  $('stage-title').textContent = stage === 'layout' ? 'コマ編集' : '文字入れ';
  $('next-btn').textContent = stage === 'layout' ? '文字入れへ ›' : '完了 ›';
  renderPool();
  updateEditorUI();
  editor.resize();
}

// ---------- 1〜2. 写真を選んで並べる ----------

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
    if (state.post && !confirm('この順で組み直すと、コマの編集と文字は消えます。よろしいですか？')) return;
    const accent = state.post ? state.post.accent : CONFIG.ACCENT_DEFAULT;
    state.post = buildFromPhotos(Math.min(state.photos.length, CONFIG.GRID.MAX_FRAMES));
    state.post.accent = accent;
    state.post.parts.forEach(p => fitWindow(p, state.photos));
    Object.assign(state, { mode: 'free', frame: 0, zoom: true });
    goStep('layout');
  });
  $('back-to-edit').addEventListener('click', () => goStep('layout'));
}

// ---------- 編集画面：写真プール ----------

function renderPool() {
  const pool = $('pool');
  pool.innerHTML = '';
  const use = state.post ? photoUsage(state.post, state.photos.length) : [];
  state.photos.forEach((ph, i) => {
    // 番号を表示。どこにも置かれていない写真は薄く
    const b = el('button', { className: 'thumb' + (state.poolPick === i ? ' on' : '') + (use[i] ? '' : ' unused') }, [
      el('img', { src: ph.thumb, alt: `写真${i + 1}` }),
      el('span', { className: 'badge', textContent: `${i + 1}` }),
    ]);
    b.addEventListener('click', () => {
      state.poolPick = state.poolPick === i ? null : i;
      renderPool();
      updateEditorUI();
    });
    pool.appendChild(b);
  });
  if (state.photos.length < CONFIG.PHOTO.MAX_COUNT) {
    const add = el('button', { className: 'add', textContent: '＋', title: '写真を読み込む' });
    add.addEventListener('click', () => $('pool-input').click());
    pool.appendChild(add);
  }
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

// spec: { free } か { col,row,cols,rows }
function addWindow(spec) {
  const win = makeWindow(spec);
  win.photo = state.poolPick != null ? state.poolPick : leastUsedPhoto(state.post, state.photos.length);
  state.post.parts.push(win);
  fitWindow(win, state.photos);
  const r = partRect(win);
  select(win, { x: r.x + r.w / 2 });
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
  $('zoom-toggle').textContent = state.zoom ? '全体' : '拡大';

  let info = `コマ ${state.frame + 1} / ${n}`;
  if (state.poolPick != null) info += `・写真${state.poolPick + 1}を持っています`;
  else if (s) info += { window: `・写真${s.photo + 1}`, beta: '・ベタ', text: '・文字' }[s.type];
  $('sel-info').textContent = info;

  if (state.stage === 'layout') {
    $('editor-hint').textContent =
      state.poolPick != null ? '台紙の写真をタップすると、選んだ写真に差し替わります。もう一度プールの写真を押すと解除。'
      : state.mode === 'grid'
        ? 'マス設計：空いているマスをなぞると新しい写真。写真をドラッグで中身を動かし、ピンチで拡大縮小。'
        : '自由設計：ドラッグで移動。ピンチか四隅で拡大縮小。辺の中央で切り取り方を変える。長押ししてからドラッグで中身だけ動かす。';
    renderLayoutPanels();
  } else {
    $('editor-hint').textContent = '文字をドラッグで移動、左右のつまみで幅を変える。';
    renderTextPanel();
  }
}

function initEditorScreen() {
  editor.init();
  $('frame-prev').addEventListener('click', () => goFrame(state.frame - 1));
  $('frame-next').addEventListener('click', () => goFrame(state.frame + 1));
  $('zoom-toggle').addEventListener('click', () => {
    state.zoom = !state.zoom;
    updateEditorUI();
    editor.resize();
  });
  $('next-btn').addEventListener('click', () => goStep(state.stage === 'layout' ? 'text' : 'export'));
  $('preview-btn').addEventListener('click', openPreview);

  $('pool-input').addEventListener('change', async e => {
    const room = CONFIG.PHOTO.MAX_COUNT - state.photos.length;
    const files = Array.from(e.target.files || []).slice(0, room);
    e.target.value = '';
    state.photos.push(...await loadInto(files, null));
    renderPool();
  });
}

// ---------- 6. 書き出し ----------

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
  $('export-back').addEventListener('click', () => goStep('text'));
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
  document.querySelectorAll('#steps button').forEach(b => b.addEventListener('click', () => goStep(b.dataset.step)));
  // フォントが届いたら字幅を測り直して描き直す
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => { clearTextLayout(); editor.requestDraw(); });
  initPhotosScreen();
  initEditorScreen();
  initLayoutPanels();
  initTextPanel();
  initPreview();
  initExportScreen();
  goStep('photos');
}
