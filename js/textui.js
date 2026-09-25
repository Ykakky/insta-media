// ============================================================
// 文字（ツールボックスの「文字」）
//  書体：明朝・ゴシック／太さ：通常・太字／斜体／級数：3種類／行間：3段階
//  文字色：基調色・白・黒＋8色／揃え：左・中央・右。1箇所 CONFIG.TYPE.maxChars 文字まで
//  選択肢はすべて CONFIG.TYPE。数値の自由入力はさせない
// ============================================================

function selectedText() {
  const s = state.selected;
  return s && s.type === 'text' ? s : null;
}

function addTextButton() {
  const T = CONFIG.TYPE, fr = frameRect(state.frame);
  const w = Math.round(fr.w * T.defaultWidth);
  const t = makeText({ x: fr.x + Math.round((fr.w - w) / 2), y: Math.round(fr.h * 0.1), w });
  state.post.parts.push(t);
  select(t);
  $('text-input').focus();
}

// 使う文字のフォント断片を読み込み、届いたら描き直す
function loadFontFor(part) {
  if (!document.fonts || !part.text) return;
  document.fonts.load(fontOf(part), part.text).then(() => { clearTextLayout(); editor.requestDraw(); }).catch(() => {});
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
  renderSeg('text-family', T.families, t.family, id => update({ family: id }));
  renderSeg('text-weight', T.weights, t.weight, id => update({ weight: id }));
  $('text-italic').classList.toggle('on', t.italic);
  renderSeg('text-role', T.roles, t.role, id => update({ role: id }));
  renderSeg('text-line', T.lineHeights, t.lineHeight, id => update({ lineHeight: id }));
  renderSeg('text-align', [{ id: 'left', label: '左' }, { id: 'center', label: '中央' }, { id: 'right', label: '右' }],
    t.align, id => update({ align: id }));

  const cc = $('text-color');
  cc.innerHTML = '';
  for (const c of T.colors) {
    const b = el('button', { className: 'swatch' + (t.color === c.id ? ' on' : ''), title: c.label, ariaLabel: c.label });
    b.style.background = resolveColor(c.id, state.post);
    b.addEventListener('click', () => update({ color: c.id }));
    cc.appendChild(b);
  }
}

function initTextPanel() {
  $('add-text').addEventListener('click', addTextButton);
  $('text-italic').addEventListener('click', () => {
    const t = selectedText();
    if (!t) return;
    t.italic = !t.italic;
    loadFontFor(t);
    renderTextPanel();
    editor.requestDraw();
  });
  $('text-input').addEventListener('input', e => {
    const t = selectedText();
    if (!t) return;
    // 絵文字なども1文字として数えて切る
    const chars = Array.from(e.target.value).slice(0, CONFIG.TYPE.maxChars);
    t.text = chars.join('');
    if (e.target.value !== t.text) e.target.value = t.text;
    $('text-count').textContent = `${chars.length} / ${CONFIG.TYPE.maxChars}`;
    loadFontFor(t);
    editor.requestDraw();
  });
  $('del-text').addEventListener('click', deleteSelected);
}
