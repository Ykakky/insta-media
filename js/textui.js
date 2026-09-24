// ============================================================
// 文字入れ：レイアウトと色が決まった後の段階
//  級数は タイトル・サブコピー・本文 の3種類だけ（数値は入力させない）
//  文字色は 基調色・白・黒、揃えは 左・中央・右。1箇所 CONFIG.TYPE.maxChars 文字まで
// ============================================================

function selectedText() {
  const s = state.selected;
  return s && s.type === 'text' ? s : null;
}

function addTextButton() {
  const T = CONFIG.TYPE, fr = frameRect(state.frame);
  const w = Math.round(fr.w * T.defaultWidth);
  const t = makeText({ x: fr.x + Math.round((fr.w - w) / 2), y: Math.round(fr.h * 0.1), w, text: '', role: 'title' });
  state.post.parts.push(t);
  select(t, { x: fr.x + fr.w / 2 });
  const input = $('text-input');
  input.focus();
}

// 使う文字のフォント断片を読み込み、届いたら描き直す
function loadFontFor(part) {
  if (!document.fonts || !part.text) return;
  document.fonts.load(fontOf(part.role), part.text).then(() => { clearTextLayout(); editor.requestDraw(); }).catch(() => {});
}

function renderSeg(id, items, current, onPick) {
  const seg = $(id);
  seg.innerHTML = '';
  for (const it of items) {
    const b = el('button', { className: it.id === current ? 'on' : '', textContent: it.label });
    b.addEventListener('click', () => onPick(it.id));
    seg.appendChild(b);
  }
}

function renderTextPanel() {
  const t = selectedText();
  $('text-panel').hidden = !t;
  if (!t) return;
  const T = CONFIG.TYPE;
  const input = $('text-input');
  if (document.activeElement !== input) input.value = t.text;
  $('text-count').textContent = `${Array.from(t.text).length} / ${T.maxChars}`;

  const update = patch => { Object.assign(t, patch); loadFontFor(t); renderTextPanel(); editor.requestDraw(); };
  renderSeg('text-role', T.roles, t.role, id => update({ role: id }));
  renderSeg('text-align', [{ id: 'left', label: '左' }, { id: 'center', label: '中央' }, { id: 'right', label: '右' }],
    t.align, id => update({ align: id }));

  const cc = $('text-color');
  cc.innerHTML = '';
  for (const c of T.colors) {
    const dot = el('span', { className: 'dot' });
    dot.style.background = resolveColor(c.id, state.post);
    const b = el('button', { className: t.color === c.id ? 'on' : '' }, [dot, c.label]);
    b.addEventListener('click', () => update({ color: c.id }));
    cc.appendChild(b);
  }
}

function initTextPanel() {
  $('add-text').addEventListener('click', addTextButton);
  $('text-input').addEventListener('input', e => {
    const t = selectedText();
    if (!t) return;
    // maxLength は UTF-16 単位なので、絵文字などを含めて文字数で切り直す
    const chars = Array.from(e.target.value).slice(0, CONFIG.TYPE.maxChars);
    t.text = chars.join('');
    if (e.target.value !== t.text) e.target.value = t.text;
    $('text-count').textContent = `${chars.length} / ${CONFIG.TYPE.maxChars}`;
    loadFontFor(t);
    editor.requestDraw();
  });
  $('del-text').addEventListener('click', deleteSelected);
}
