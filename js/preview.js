// ============================================================
// プレビュー：投稿画面に似せたダミーの枠で、4:5の画像を1枚ずつ見せる
// 指で左右にスワイプして切り替える（横スクロール＋スナップ）。編集はしない。
// コマの境目の線などの補助線は描かない。
// ============================================================

const preview = { urls: [] };

async function openPreview() {
  const track = $('pv-track'), dots = $('pv-dots');
  track.innerHTML = '<p class="pv-loading">準備中…</p>';
  dots.innerHTML = '';
  $('preview').hidden = false;
  await ensureFonts(state.post);

  const g = CONFIG.GRID;
  const c = document.createElement('canvas');
  c.width = g.FRAME_W; c.height = g.FRAME_H;
  const ctx = c.getContext('2d');
  const urls = [];
  for (let i = 0; i < state.post.n; i++) {
    ctx.setTransform(1, 0, 0, 1, -g.FRAME_W * i, 0);
    drawPost(ctx, state.post, state.photos);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    urls.push(URL.createObjectURL(blob));
  }
  c.width = c.height = 0;
  closePreviewUrls();
  preview.urls = urls;

  track.innerHTML = '';
  urls.forEach((u, i) => track.appendChild(el('img', { src: u, alt: `${i + 1}枚目`, draggable: false })));
  urls.forEach(() => dots.appendChild(el('i')));
  track.scrollLeft = 0;
  updateDots();
}

function updateDots() {
  const track = $('pv-track');
  const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  [...$('pv-dots').children].forEach((d, k) => d.classList.toggle('on', k === i));
}

function closePreviewUrls() {
  preview.urls.forEach(u => URL.revokeObjectURL(u));
  preview.urls = [];
}

function closePreview() {
  $('preview').hidden = true;
  $('pv-track').innerHTML = '';
  closePreviewUrls();
}

function initPreview() {
  $('preview-close').addEventListener('click', closePreview);
  $('pv-track').addEventListener('scroll', updateDots, { passive: true });
}
