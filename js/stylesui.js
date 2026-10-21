// ============================================================
// スタイルの一覧・書き出し・読み込み（シート）
//  書き出し：1件ずつ／保存したもの全部。JSON を画面に出してコピー、またはファイルで保存
//  読み込み：JSON を貼り付けて追加（既存は消さない。同じ名前には番号を付ける）
// ============================================================

const styleUI = { json: '', filename: '' };

function openStyleSheet() {
  $('style-sheet').hidden = false;
  showStyleView('list');
}

function closeStyleSheet() {
  $('style-sheet').hidden = true;
  refreshStyleRows();
}

function showStyleView(view) {
  document.querySelectorAll('#style-sheet [data-view]').forEach(v => { v.hidden = v.dataset.view !== view; });
  $('style-sheet-back').hidden = view === 'list';
  $('style-sheet-title').textContent = { list: 'スタイル', export: '書き出し', import: '読み込み' }[view];
  $('style-sheet').querySelector('.sheet-body').scrollTop = 0;
  if (view === 'list') renderManageList();
  if (view === 'import') { $('import-msg').textContent = ''; }
}

// 一覧：写真の枚数ごとにまとめて並べる
function renderManageList() {
  const box = $('style-manage-list');
  box.innerHTML = '';
  const list = allStyles();
  $('export-all-styles').disabled = !list.some(s => !s.preset);
  if (!list.length) {
    box.appendChild(el('p', { className: 'hint', textContent: 'スタイルはまだありません。編集画面の「配置」から保存するか、ここで読み込めます。' }));
    return;
  }
  const counts = [...new Set(list.map(s => s.photoCount))].sort((a, b) => a - b);
  for (const c of counts) {
    box.appendChild(el('div', { className: 'label', textContent: `${c}枚のスタイル` }));
    for (const st of list.filter(s => s.photoCount === c)) {
      const meta = el('div', { className: 'sm-meta' }, [
        el('div', { className: 'sm-name', textContent: st.name }),
        el('div', { className: 'sm-sub', textContent: `${st.n}コマ` + (st.preset ? '・初期プリセット' : '') }),
      ]);
      const ex = el('button', { className: 'sub', textContent: '書き出し' });
      ex.addEventListener('click', () => openExport([st], `「${st.name}」`, `style-${safeFileName(st.name)}.json`));
      const actions = el('div', { className: 'sm-actions' }, [ex]);
      if (!st.preset) {
        const del = el('button', { className: 'sub', textContent: '削除' });
        del.addEventListener('click', () => {
          if (!confirm(`スタイル「${st.name}」を削除しますか？`)) return;
          removeStyle(st.id);
          renderManageList();
        });
        actions.appendChild(del);
      }
      box.appendChild(el('div', { className: 'sm-item' }, [styleThumb(st), meta, actions]));
    }
  }
}

function safeFileName(name) {
  return (name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)) || 'style';
}

function openExport(styles, label, filename) {
  styleUI.json = exportStylesJson(styles);
  styleUI.filename = filename;
  $('export-note').textContent = `${label}（${styles.length}件）。コピーしてメモなどに貼り付けるか、ファイルで保存してください。`;
  $('style-json-out').value = styleUI.json;
  $('copy-msg').textContent = '';
  showStyleView('export');
}

// コピー：使えればクリップボードAPI（https のときだけ）、だめなら選択してコピー
async function copyStyleJson() {
  const ta = $('style-json-out'), text = styleUI.json;
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (_) { /* 下の方法を試す */ }
  if (!ok) {
    ta.focus();
    ta.setSelectionRange(0, text.length);
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  }
  $('copy-msg').textContent = ok
    ? 'コピーしました。'
    : 'コピーできませんでした。枠の中を長押しして「すべてを選択」→「コピー」で写してください。';
}

function downloadStyleJson() {
  const url = URL.createObjectURL(new Blob([styleUI.json], { type: 'application/json' }));
  const a = el('a', { href: url, download: styleUI.filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function doImportStyles() {
  const text = $('style-json-in').value.trim();
  if (!text) { $('import-msg').textContent = 'JSONを貼り付けてください。'; return; }
  const res = importStylesJson(text);
  if (res.error) { $('import-msg').textContent = res.error; return; }
  $('style-json-in').value = '';
  $('import-msg').textContent = `${res.added.length}件を追加しました：${res.added.join('、')}`;
  refreshStyleRows();
}

// 画面に出ているスタイル一覧を作り直す
function refreshStyleRows() {
  renderPhotoStyles();
  if (state.post && state.tool === 'layout') renderLayoutBox();
}

function initStyleSheet() {
  document.querySelectorAll('[data-open-styles]').forEach(b => b.addEventListener('click', openStyleSheet));
  $('style-sheet-close').addEventListener('click', closeStyleSheet);
  $('style-sheet-back').addEventListener('click', () => showStyleView('list'));
  $('style-sheet').addEventListener('click', e => { if (e.target === $('style-sheet')) closeStyleSheet(); });
  $('export-all-styles').addEventListener('click', () => {
    const mine = allStyles().filter(s => !s.preset);
    const d = new Date(), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    openExport(mine, '保存したスタイル全部', `carousel-styles-${ymd}.json`);
  });
  $('open-import').addEventListener('click', () => showStyleView('import'));
  $('copy-json').addEventListener('click', copyStyleJson);
  $('download-json').addEventListener('click', downloadStyleJson);
  $('do-import').addEventListener('click', doImportStyles);
}
