// ============================================================
// ツールボックス：配置・色調・背景・グリッド（文字は textui.js）
// どれも「選択中の写真1枚」か「表示中のコマ」だけを変える。
// ============================================================

function renderToolbox() {
  switch (state.tool) {
    case 'layout': renderLayoutBox(); break;
    case 'tone':   renderTonePanel(); break;
    case 'bg':     renderBgPanel(); break;
    case 'grid':   renderGridBox(); break;
  }
}

// ---------- 配置：置き方（写真1枚ずつ） ----------

// 置き方を当てる写真：選択中の写真。なければ、表示中のコマに写真が1枚だけならそれ
function cassetteTarget() {
  const s = state.selected;
  if (s && s.type === 'window') return s;
  const here = state.post.parts.filter(p => p.type === 'window' && homeFrame(state.post, p) === state.frame);
  return here.length === 1 ? here[0] : null;
}

function renderCassetteRow() {
  const row = $('cas-row');
  row.innerHTML = '';
  const target = cassetteTarget();
  $('cas-label').textContent = target ? `置き方（写真${target.photo + 1}）` : '置き方 — 写真をタップして選んでください';
  for (const [key, c] of Object.entries(CASSETTES)) {
    const b = el('button', { className: 'cas' + (target && target.cassette === key ? ' on' : ''), disabled: !target },
      [cassetteThumb(key), el('span', { textContent: c.label })]);
    b.addEventListener('click', () => {
      const win = cassetteTarget();
      if (!win) return;
      const n0 = state.post.n;
      pushHistory();
      const res = applyCassette(state.post, win, state.frame, key, state.photos);
      if (res.error) {
        undoLog.stack.pop(); updateUndoButton(); // 何も変わっていないので控えも捨てる
        state.selected = state.post.parts.find(p => p.id === win.id) || null;
        alert(res.error);
        return;
      }
      fitWindow(win, state.photos);
      state.selected = win;
      updateEditorUI();
      if (state.post.n !== n0) editor.resize(); else editor.requestDraw();
    });
    row.appendChild(b);
  }
}

// 置き方の線画：コマの枠と、写真の位置（切れる部分は点線）
function cassetteThumb(key) {
  const NS = 'http://www.w3.org/2000/svg';
  const c = CASSETTES[key], FW = CONFIG.GRID.FRAME_W, FH = CONFIG.GRID.FRAME_H;
  const W = FW * c.span, pad = 60;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${W + pad * 2} ${FH + pad * 2}`);
  const add = attrs => {
    const e = document.createElementNS(NS, attrs.tag || 'rect');
    delete attrs.tag;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.appendChild(e);
  };
  for (let f = 0; f < c.span; f++) add({ x: f * FW, y: 0, width: FW, height: FH, fill: '#2a2a2a', stroke: '#888', 'stroke-width': 16 });
  const r = c.rect;
  if (c.clip) {
    add({ x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: '#9cf', 'stroke-width': 14, 'stroke-dasharray': '40 30' });
    const x = Math.max(0, r.x), x2 = Math.min(FW, r.x + r.w);
    add({ x, y: r.y, width: x2 - x, height: r.h, fill: '#3d5a75', stroke: '#9cf', 'stroke-width': 22 });
  } else {
    add({ x: r.x, y: r.y, width: r.w, height: r.h, fill: '#3d5a75', stroke: '#9cf', 'stroke-width': 22 });
  }
  return svg;
}

// ---------- 配置：写真プール ----------

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

// ---------- 配置：スタイル ----------

// list をサムネイルで並べる。inEditor なら削除ボタンも付ける（初期プリセットは削除できない）
function renderStyleRow(row, list, inEditor) {
  row.innerHTML = '';
  if (!list.length) {
    row.appendChild(el('span', { className: 'hint', textContent: 'この枚数のスタイルはまだありません。' }));
    return;
  }
  for (const st of list) {
    const b = el('button', { className: 'style-item' }, [styleThumb(st), el('span', { textContent: st.name })]);
    if (st.preset) b.appendChild(el('i', { className: 'preset-badge', textContent: '初期' }));
    b.addEventListener('click', () => applyStyleItem(st));
    const wrap = el('div', { className: 'style-wrap' }, [b]);
    if (inEditor && !st.preset) {
      const del = el('button', { className: 'style-del', textContent: '×', ariaLabel: `${st.name}を削除` });
      del.addEventListener('click', () => {
        if (!confirm(`スタイル「${st.name}」を削除しますか？`)) return;
        removeStyle(st.id);
        renderLayoutBox();
      });
      wrap.appendChild(del);
    }
    row.appendChild(wrap);
  }
}

function applyStyleItem(st) {
  if (state.post && !confirm(`スタイル「${st.name}」を当てはめますか？\n今の配置・色調・背景色は置き換わります（文字は残ります）。`)) return;
  pushHistory();
  const texts = state.post ? state.post.parts.filter(p => p.type === 'text') : [];
  startWithPost(postFromStyle(st, texts));
}

function saveStyleButton() {
  const n = state.photos.length;
  const d = new Date();
  const def = `${n}枚・${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const name = prompt('スタイルの名前', def);
  if (name == null) return;
  const saved = name.trim() || def;
  const ok = addStyle(postToStyle(state.post, n, saved));
  $('style-save-msg').textContent = ok
    ? `「${saved}」を保存しました（${n}枚用）。写真画面の一覧から当てはめられます。`
    : '保存できませんでした（このブラウザでは保存領域が使えない可能性があります。プライベートブラウズでは保存できません）。';
  refreshStyleRows();
}

function renderLayoutBox() {
  const s = state.selected, n = state.post.n;
  renderCassetteRow();
  renderPool();
  $('add-window').textContent = state.poolPick != null ? `新規配置（写真${state.poolPick + 1}）` : '新規配置';
  $('to-front').disabled = !s;
  $('to-back').disabled = !s;
  $('del-part').disabled = !s;
  $('add-frame').disabled = n >= CONFIG.GRID.MAX_FRAMES;
  $('del-frame').disabled = n <= CONFIG.GRID.MIN_FRAMES;
}

// ---------- 色調（写真ごと）と基調色（投稿全体） ----------

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
  if (id === state.post.accent) return;
  pushHistory();
  state.post.accent = id;
  pruneToneCache(state.post, state.photos);
  renderTonePanel();
  editor.requestDraw();
}

function setTone(win, patch) {
  if (!win) return;
  pushHistory();
  win.tone = { ...win.tone, ...patch };
  pruneToneCache(state.post, state.photos);
  renderTonePanel();
  editor.requestDraw();
}

function applyToneToAll() {
  const win = state.selected;
  if (!win || win.type !== 'window') return;
  pushHistory();
  for (const p of state.post.parts) if (p.type === 'window') p.tone = { ...win.tone };
  pruneToneCache(state.post, state.photos);
  renderTonePanel();
  editor.requestDraw();
}

// ---------- 背景色（コマごと。基調色とは独立） ----------
// 対象：ベタを選んでいればそのベタ、なければ表示中のコマの背景

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
  // スライダーを動かし続けている間は1回分として控える
  pushHistory(fromSlider ? 'bg:' + (state.selected ? state.selected.id : 'frame' + state.frame) : null);
  bgTarget().set(color);
  renderBgPanel(fromSlider);
  editor.requestDraw();
}

// ---------- グリッド ----------

function renderGridBox() {
  document.querySelectorAll('#grid-seg button').forEach(b => b.classList.toggle('on', (b.dataset.grid === 'on') === state.grid));
}

// ---------- 初期化 ----------

function initToolbox() {
  $('add-window').addEventListener('click', addPhotoHere);
  $('to-front').addEventListener('click', bringToFront);
  $('to-back').addEventListener('click', sendToBack);
  $('del-part').addEventListener('click', deleteSelected);
  $('add-frame').addEventListener('click', () => {
    if (state.post.n >= CONFIG.GRID.MAX_FRAMES) return;
    pushHistory();
    addFrameAfter(state.post, state.frame);
    goFrame(state.frame + 1);
  });
  $('del-frame').addEventListener('click', () => {
    if (state.post.n <= CONFIG.GRID.MIN_FRAMES) return;
    if (!confirm(`コマ${state.frame + 1}を削除しますか？（このコマの写真と文字も消えます）`)) return;
    pushHistory();
    deleteFrame(state.post, state.frame);
    pruneToneCache(state.post, state.photos);
    goFrame(Math.min(state.frame, state.post.n - 1));
  });
  $('tone-all').addEventListener('click', applyToneToAll);
  for (const id of ['bg-h', 'bg-s', 'bg-l']) {
    $(id).addEventListener('input', () => setBg(hslToHex(+$('bg-h').value, +$('bg-s').value, +$('bg-l').value), true));
  }
  $('bg-all').addEventListener('click', () => {
    pushHistory();
    const c = bgTarget().get();
    state.post.frameBg = state.post.frameBg.map(() => c);
    editor.requestDraw();
  });
  document.querySelectorAll('#grid-seg button').forEach(b => b.addEventListener('click', () => {
    state.grid = b.dataset.grid === 'on';
    renderGridBox();
    editor.requestDraw();
  }));
}
