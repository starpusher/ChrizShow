/* ======= Rollen & Broadcast ======= */
const params = new URLSearchParams(location.search);

const HOST_SECRET = '314159';

let role = params.get('view') || 'screen';  // 'host' | 'screen'
if (role === 'host') {
  const key = params.get('key');
  if (key !== HOST_SECRET) {
    // Falscher oder fehlender Schlüssel → auf Screen-Ansicht zurückfallen
    role = 'screen';
  }
}
if (role === 'screen') document.body.classList.add('audience');

const remoteRoomId = params.get('room') || 'default';

const chan = new BroadcastChannel('quiz-show');
function send(type, payload={}) { if (role === 'host') chan.postMessage({ type, payload }); }
chan.onmessage = ({ data }) => handleMsg(data);

function handleMsg(msg) {
  const { type, payload } = msg || {};
  if (role !== 'screen') { 
    // Host listens to audience play/pause requests (if ever enabled)
    if (type === 'AUD_PLAY') { if (!els.qAud.hidden){ els.qAud.play().catch(()=>{}); } return; }
    if (type === 'AUD_PAUSE'){ if (!els.qAud.hidden){ els.qAud.pause(); } return; }
    if (type === 'SCREEN_READY'){ sendSync(); return; }
    return;
  }
  switch (type) {
    case 'JOKER_USED': {
      // Publikum: kurze Joker-Animation
      if (payload) showJokerFx(payload);
      break;
    }
    case 'FX': { fx((payload&&payload.type)||'correct'); break; }
    case 'SHOW_Q': showForAudience(payload); break;
    case 'REVEAL_ANSWER':
      resetAnswerImages();
      showAnswerImagesForCurrent();
      els.answer.hidden = false;
      break;
    case 'RESOLVE_Q':
      state.q[payload.id] = { status: 'resolved', attempts: [] };
      state.used.add(payload.id);
      if (els.modal.open) els.modal.close();

      // NEU: Antwortbilder zurücksetzen (Publikum)
      resetAnswerImages();

      renderBoard(); renderOverlay();
      break;
    case 'SCORES':
      state.scores = payload.scores; renderPlayersBar(true); renderOverlay(); break;
    case 'TURN':
      state.turn = payload.turn; renderOverlay(); break;
    case 'TIMER':
      if (payload.seconds>0 && els.timerBox) els.timerBox.hidden=false;
      if (payload.seconds<=0 && els.timerBox) els.timerBox.hidden=true;
      showTimer(payload.seconds); break;
    case 'AUDIO_META':
      if (!els.qAud.hidden){ els.qAud.muted = true; els.qAud.currentTime = payload.t||0; } break;
    case 'AUDIO_PLAY':
      if (!els.qAud.hidden){ els.qAud.muted = true; els.qAud.play().catch(()=>{}); } break;
    case 'AUDIO_PAUSE':
      if (!els.qAud.hidden){ els.qAud.pause(); } break;
    case 'AUDIO_TIME':
      if (!els.qAud.hidden){ els.qAud.currentTime = payload.t||0; } break;
    case 'SWAP_IMAGE':
      if (current?.q) {
        const base = (data.settings && data.settings.media_base) || 'media/';
        const q = current.q;
        if (payload.mode === 'reveal' && q.image_reveal) {
          els.qImg.src = base + q.image_reveal; els.qImg.hidden = false;
        }
        if (payload.mode === 'pixel' && q.image) {
          els.qImg.src = base + q.image; els.qImg.hidden = false;
        }
      }
      break;
    case 'SYNC_STATE':
      data = payload.data;
      window.SFX_BASE = (payload.data && payload.data.settings && payload.data.settings.media_base) || window.SFX_BASE || 'media/';
      if (!window.SFX_BASE.endsWith('/')) window.SFX_BASE += '/';
      Object.assign(state, { players: payload.state.players, scores: payload.state.scores, q: payload.state.q||{}, settings: payload.state.settings||{}, turn: payload.state.turn||0, current: payload.state.current || null });
      state.used = new Set(payload.state.used || []);
      renderPlayersBar(true); renderBoard(); renderOverlay();
      applyCurrentForScreen();
      syncAudienceAudioFromState();
      break;
  }
}
if (role === 'screen') chan.postMessage({ type: 'SCREEN_READY' });
// unlock sfx after first interaction on audience
if (role==='screen'){
  const __unlock = ()=>{ try{ playSfx('correct',{prime:true}); playSfx('wrong',{prime:true}); }catch(e){};
    window.removeEventListener('pointerdown', __unlock);
    window.removeEventListener('keydown', __unlock);
  };
  window.addEventListener('pointerdown', __unlock);
  window.addEventListener('keydown', __unlock);
}

/* ======= DOM ======= */
const els = {
  board: document.getElementById('board'),
  playersBar: document.getElementById('playersBar'),
  overlay: document.getElementById('overlay'),
  modal: document.getElementById('qModal'),
  qCat: document.getElementById('qCat'),
  qPts: document.getElementById('qPts'),
  qText: document.getElementById('qText'),
  qImg: document.getElementById('qImg'),
  qAud: document.getElementById('qAud'),
  qVid: document.getElementById('qVid'),
  answer: document.getElementById('answer'),
  revealBtn: document.getElementById('revealBtn'),
  swapImageBtn: document.getElementById('swapImageBtn'),
  playerSelect: document.getElementById('playerSelect'),
  attemptInfo: document.getElementById('attemptInfo'),
  correctBtn: document.getElementById('correctBtn'),
  wrongBtn: document.getElementById('wrongBtn'),
  skipBtn: document.getElementById('skipBtn'),
  pauseAud: document.getElementById('pauseAud'),
  playAud: document.getElementById('playAud'),
  timerBtn: document.getElementById('timerBtn'),
  timerBox: document.getElementById('timerBox'),
  turnBadge: document.getElementById('turnBadge'),
  resetBtn: document.getElementById('resetBtn'),
  roundResetBtn: document.getElementById('roundResetBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  loadBtn: document.getElementById('loadBtn'),
  loadFile: document.getElementById('loadFile'),
  boardSelect: document.getElementById('boardSelect'),
  presentBtn: document.getElementById('presentBtn'),
  addPlayerBtn: document.getElementById('addPlayerBtn'),
  undoBtn: document.getElementById('undoBtn'),
  fx: document.getElementById('fx'),
  answerImages: document.getElementById('answerImages'),
  ansImg1: document.getElementById('ansImg1'),
  ansImg2: document.getElementById('ansImg2')
};

/* ======= Joker-FX (Publikum) ======= */
function ensureJokerFxEl(){
  let root = document.getElementById('jokerFx');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'jokerFx';
  root.innerHTML = `
    <div class="jokerfx-box" aria-hidden="true">
      <div class="jokerfx-label">JOKER</div>
      <div class="jokerfx-icon">★</div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function showJokerFx({ jokerKey, playerId }={}){
  if (role !== 'screen') return;
  const root = ensureJokerFxEl();
  const box = root.querySelector('.jokerfx-box');
  const label = root.querySelector('.jokerfx-label');
  const icon = root.querySelector('.jokerfx-icon');

  const meta = {
    j1: { title: 'JOKER', icon: '⇄' },
    j2: { title: 'RISIKO-JOKER', icon: '🎲' },
    j3: { title: 'TELEFON-JOKER', icon: '☎️' }
  };
  const m = meta[jokerKey] || { title:'JOKER', icon:'★' };

  // optional: Spielername anzeigen, wenn vorhanden (ohne Layout zu verändern)
  const pname = (state.players || []).find(p => p.id === playerId)?.name;
  label.textContent = pname ? `${m.title} • ${pname}` : m.title;
  icon.textContent = m.icon;

  // retrigger animation
  root.classList.remove('show');
  void root.offsetWidth;
  root.classList.add('show');

  // kleine Vibration nur, wenn unterstützt
  try { if (navigator.vibrate) navigator.vibrate(40); } catch(e) {}
}

/* ======= Daten & State ======= */
let data = null;
let boards = [];
const state = {
  players: [],                    // {id,name,avatar?, jokers?}
  scores: {},                     // id -> number
  q: {},                          // questionId -> {status, attempts, winner, starter}
  used: new Set(),
  settings: {},
  history: [],
  audio: { playing:false, t:0, ts:0 },
  current: null,                  // aktuell offene Frage (für Publikum)
  turn: 0                         // Index des aktuellen Spielers
};
let current = { col: -1, row: -1, q: null, id: null };
let timerInt = null;

/* ======= Init ======= */
init();
async function init() {
  if (role === 'host') {
    await loadBoardsList();               // optional: lädt data/boards.json, falls vorhanden
    const startUrl = getInitialBoardUrl();
    await loadContent(startUrl);
  } else {
    // Screen lädt kein eigenes JSON, sondern wartet auf Sync vom Host
  }
  loadState();
  renderPlayersBar(role === 'screen');
  renderBoard();
  renderOverlay();
  attachGlobalHandlers();
  if (role === 'host') {
    sendSync();
  } else {
    setupRemoteListener();
  }
}

async function loadContent(urlOrFileText) {
  if (typeof urlOrFileText === 'string' && urlOrFileText.trim().startsWith('{')) {
    data = JSON.parse(urlOrFileText);
  } else if (typeof urlOrFileText === 'string') {
    const res = await fetch(urlOrFileText);
    data = await res.json();
  } else {
    data = urlOrFileText;
  }
  state.settings = data.settings || {};
  state.players = (data.players || ['Spieler 1','Spieler 2']).map((name, i) => ({ id: `p${i+1}`, name, avatar: null, jokers:{j1:true,j2:true,j3:true} }));
  for (const p of state.players) if (!(p.id in state.scores)) state.scores[p.id] = 0;
}

async function loadBoardsList() {
  if (role !== 'host') return;
  try {
    const res = await fetch('data/boards.json', { cache: 'no-store' });
    if (!res.ok) return;
    const raw = await res.json();
    if (!Array.isArray(raw)) return;

    boards = raw.map((item, idx) => {
      if (typeof item === 'string') {
        const file = item.replace(/^data\//, '');
        const url = 'data/' + file;
        return {
          id: `b${idx}`,
          label: file.replace(/\.json$/,''),
          url
        };
      }
      const file = (item.file || item.path || item.name || '').replace(/^data\//, '');
      const url = file ? ('data/' + file) : null;
      return {
        id: item.id || `b${idx}`,
        label: item.label || item.name || (file && file.replace(/\.json$/,'')) || `Board ${idx+1}`,
        url
      };
    }).filter(b => !!b.url);

    if (els.boardSelect) {
      els.boardSelect.innerHTML = '';
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = boards.length ? 'Board wählen…' : 'Keine Boards gefunden';
      els.boardSelect.appendChild(opt0);
      boards.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.label;
        opt.dataset.url = b.url;
        els.boardSelect.appendChild(opt);
      });
      els.boardSelect.hidden = boards.length === 0;
    }
  } catch (e) {
    console.warn('boards.json konnte nicht geladen werden', e);
  }
}

function getInitialBoardUrl() {
  const saved = localStorage.getItem('quiz_board_file');
  if (saved && boards.some(b => b.url === saved)) {
    const b = boards.find(b => b.url === saved);
    if (els.boardSelect && b) els.boardSelect.value = b.id;
    return saved;
  }
  if (boards.length) {
    const first = boards[0];
    if (els.boardSelect) els.boardSelect.value = first.id;
    localStorage.setItem('quiz_board_file', first.url);
    return first.url;
  }
  return 'data/questions.json';
}

async function loadBoardFromUrl(url) {
  if (!url) return;

  // Spieler, Scores & Zug merken
  const prevPlayers = state.players.map(p => ({
    id: p.id,
    name: p.name,
    jokers: p.jokers || { j1: true, j2: true, j3: true }
  }));
  const prevScores = { ...state.scores };
  const prevTurn = state.turn;

  // Neues Board laden
  await loadContent(url);

  // Spieler & Punkte wiederherstellen
  state.players = prevPlayers;
  state.scores = prevScores;
  state.turn = prevTurn;

  // Nur Fragenfortschritt zurücksetzen
  state.q = {};
  state.used = new Set();
  state.history = [];

  localStorage.setItem('quiz_board_file', url);
  saveState();
  renderPlayersBar();
  renderBoard();
  renderOverlay();
  sendSync();
}
window.SFX_BASE = (data && data.settings && data.settings.media_base) || 'media/';
if (!window.SFX_BASE.endsWith('/')) window.SFX_BASE += '/';

/* ======= Render ======= */
function renderPlayersBar(readOnly=false) {
  els.playersBar.innerHTML = '';
  state.players.forEach((p, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'pill';

    const img = document.createElement('img'); img.className='avatar'; img.alt=''; img.src = p.avatar || ''; if (!p.avatar) img.style.opacity=.4;
    const file = document.createElement('input'); file.type='file'; file.accept='image/*'; file.className='file';
    file.onchange = e => {
      const f = e.target.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        p.avatar = reader.result;
        saveState();
        renderOverlay();
        sendSync();
        img.src = p.avatar;
        img.style.opacity = 1;
        file.value = ''; // Reset danach, damit man denselben Avatar nochmal wählen kann
      };
      reader.readAsDataURL(f);
    };

    const name = document.createElement('input'); name.type='text'; name.value=p.name; name.disabled=readOnly||role==='screen';
    name.addEventListener('change', ()=>{ p.name=name.value; saveState(); renderOverlay(); sendSync(); });

    const score = document.createElement('span'); score.className='score'; score.textContent = state.scores[p.id] ?? 0;
    if (!readOnly && role!=='screen') {
      score.setAttribute('contenteditable','true');
      score.addEventListener('blur', () => {
        const val = parseInt(score.textContent.replace(/[^\d-]+/g,'')) || 0;
        const delta = val - (state.scores[p.id]||0);
        if (delta !== 0) addPoints(p.id, delta, {log:true});
        score.textContent = state.scores[p.id]; saveState(); renderOverlay(); sendSync();
      });
    }

    // Joker toggles (visual only)
    const jokers = document.createElement('div'); jokers.className='jokers';
    ['j1','j2','j3'].forEach((key,i)=>{
      const el = document.createElement('div'); el.className = 'joker ' + key + (p.jokers?.[key]? '' : ' off');
      el.textContent = i===0?'⇄':(i===1?'🎲':'☎️');
      el.title = i===0?'Zuschiebe-Joker':(i===1?'Risikojoker':'Telefonjoker');
      if (role==='host' && !readOnly){
        el.onclick = () => {
          const prev = !!p.jokers?.[key];
          p.jokers[key] = !prev;
          el.classList.toggle('off', !p.jokers[key]);
          saveState();
          renderOverlay();
          sendSync();
          // Publikum: Animation nur beim "Verbrauchen" (an -> aus)
          if (prev && !p.jokers[key]) send('JOKER_USED', { jokerKey: key, playerId: p.id });
        };
      }
      jokers.appendChild(el);
    });

    const rm = document.createElement('button'); rm.textContent='🗑'; rm.className='rm';
    rm.onclick = () => removePlayer(idx);

    img.style.cursor = (role==='host' && !readOnly) ? 'pointer' : 'default';
    img.onclick = () => {
      if (role!=='host' || readOnly) return;
      try {
        file.value = '';                               // wichtig: reset, sonst kein change
        file.dispatchEvent(new MouseEvent('click', { bubbles:true }));
      } catch(e) {
        file.click();                                  // Fallback
      }
    };


    wrap.append(img, name, score, jokers, rm, file);
    els.playersBar.appendChild(wrap);

    p._scoreEl = score;
  });
}

function renderBoard() {
  // Wenn noch keine Daten synchronisiert wurden (Publikum vor Host-Sync),
  // einfach nichts anzeigen und auf den ersten SYNC_STATE warten.
  if (!data || !Array.isArray(data.categories) || !data.categories.length) {
    els.board.innerHTML = '';
    return;
  }

  const cats = data.categories;
  const cols = cats.length;
  const maxRows = Math.max(...cats.map(c => c.questions.length));
  els.board.style.gridTemplateColumns = `repeat(${cols}, minmax(140px,1fr))`;
  els.board.innerHTML = '';

  // Header
  for (const cat of cats) {
    const h = document.createElement('div');
    h.className = 'tile category';
    h.textContent = cat.title;
    els.board.appendChild(h);
  }

  // Tiles
  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < cols; c++) {
      const q = cats[c].questions[r];
      const tile = document.createElement('button');
      tile.className = 'tile';
      tile.disabled = !q;

      if (!q) { tile.textContent = '—'; els.board.appendChild(tile); continue; }

      tile.textContent = q.points;
      const id = q.id || `${c}-${r}`;
      if (state.used.has(id) || (state.q[id]?.status === 'resolved')) tile.classList.add('used');

      if (role === 'host') tile.addEventListener('click', () => openQuestion(c, r));
      els.board.appendChild(tile);
    }
  }
}

function renderOverlay(){
  els.overlay.innerHTML = '';
  state.players.forEach((p, idx) => {
    const card = document.createElement('div'); card.className='card' + (idx===state.turn ? ' active' : '');
    const img = document.createElement('img'); img.className='avatar'; img.src = p.avatar || ''; if (!p.avatar) img.style.opacity=.4;
    const meta = document.createElement('div'); meta.className='meta';
    const nm = document.createElement('div'); nm.className='name'; nm.textContent = p.name;
    const pts = document.createElement('div'); pts.className='pts'; pts.textContent = `${state.scores[p.id]||0} Punkte`;
    const jokers = document.createElement('div'); jokers.className='jokers';
    ['j1','j2','j3'].forEach((key,i)=>{
      const el = document.createElement('div'); el.className = 'joker ' + key + (p.jokers?.[key]? '' : ' off');
      el.textContent = i===0?'⇄':(i===1?'🎲':'☎️');
      if (role==='host'){
        el.onclick = () => {
          const prev = !!p.jokers?.[key];
          p.jokers[key] = !prev;
          el.classList.toggle('off', !p.jokers[key]);
          saveState();
          sendSync();
          if (prev && !p.jokers[key]) send('JOKER_USED', { jokerKey: key, playerId: p.id });
        };
      }
      jokers.appendChild(el);
    });
    meta.append(nm, pts); card.append(img, meta, jokers); els.overlay.appendChild(card);

    if (role==='host') card.onclick = () => { state.turn = idx; saveState(); renderOverlay(); sendTurn(); };
  });
}

/* ======= Modal / Host-Flow ======= */
function openQuestion(col, row) {
  const cat = data.categories[col];
  const q = cat.questions[row];
  const id = q.id || `${col}-${row}`;
  current = { col, row, q, id };

  markBusyTile(true);

  // Inhalt
  els.qCat.textContent = cat.title;
  els.qPts.innerHTML = `<span class="pos">+${q.points}</span> <span class="neg">-${Math.floor(q.points/2)}</span>`;
  els.qText.textContent = q.text || '';
  els.answer.textContent = q.answer || '—';
  // Host sieht Antwort sofort:
  els.answer.hidden = role !== 'host';
  setMedia(q);
  resetAnswerImages();


  const starterId = state.players[state.turn]?.id;
  const qst = state.q[id] ||= { status: 'open', attempts: [], starter: starterId };
  qst.status = 'open';

  // aktuell offene Frage im globalen State merken (für Publikum)
  state.current = { id, answerRevealed: false };
  state.audio = { playing:false, t:0, ts: Date.now() };
  saveState();
  sendSync();

  send('SHOW_Q', { id, q: { cat: cat.title, points: q.points, text: q.text, answer: q.answer, image: q.image, image_reveal: q.image_reveal, audio: q.audio, video: q.video, answer_images: q.answer_images, ans1: q.ans1, ans2: q.ans2 }});

  populatePlayerSelect(id, starterId);
  updateAttemptInfo(id);

  els.revealBtn.onclick = () => {
    els.answer.hidden = false; 
    // Antwort als aufgedeckt im globalen State markieren
    if (state.current && state.current.id === current.id) {
      state.current.answerRevealed = true;
    } else {
      state.current = { id: current.id, answerRevealed: true };
    }
    saveState();
    sendSync();
    send('REVEAL_ANSWER');
    const base = (data.settings && data.settings.media_base) || 'media/';
    // optional single reveal image
    if (current.q.answer_image) {
      els.qImg.src = base + current.q.answer_image; els.qImg.hidden = false;
      send('SWAP_IMAGE', { mode:'reveal' });
    }
    // answer images (0–2)
    showAnswerImages(current.q, base);
};

  els.correctBtn.onclick = () => onResult('correct');
  els.wrongBtn.onclick   = () => onResult('wrong');
  els.skipBtn.onclick    = () => finishQuestion(null);

  els.playAud.onclick = () => {
    if (!els.qAud.hidden){
      state.audio = { playing:true, t: els.qAud.currentTime || 0, ts: Date.now() };
      saveState();
      sendSync();
      els.qAud.play().catch(()=>{});
    }
  };
  els.pauseAud.onclick = () => {
    if (!els.qAud.hidden){
      state.audio = { playing:false, t: els.qAud.currentTime || 0, ts: Date.now() };
      saveState();
      sendSync();
      els.qAud.pause();
    }
  };

  // Swap image button
  els.swapImageBtn.hidden = !(q.image && q.image_reveal);
  els.swapImageBtn.onclick = () => {
    const base = (data.settings && data.settings.media_base) || 'media/';
    if (els.qImg.dataset.alt === 'reveal') {
      els.qImg.src = base + q.image; els.qImg.dataset.alt = 'pixel';
      send('SWAP_IMAGE', { mode:'pixel' });
    } else {
      els.qImg.src = base + q.image_reveal; els.qImg.dataset.alt = 'reveal';
      send('SWAP_IMAGE', { mode:'reveal' });
    }
  };

  // Audio sync events
  if (els.qAud && !els.qAud.hidden) {
    const sendTime = () => send('AUDIO_TIME', { t: els.qAud.currentTime });
    const onPlay   = () => { send('AUDIO_PLAY'); send('AUDIO_META', { t: els.qAud.currentTime }); };
    const onPause  = () => send('AUDIO_PAUSE');
    els.qAud.addEventListener('timeupdate', sendTime);
    els.qAud.addEventListener('play', onPlay);
    els.qAud.addEventListener('pause', onPause);
  }

  // Timer
  els.timerBtn.onclick = () => startTimer(10);

  els.modal.addEventListener('close', onModalCloseOnce, { once: true });
  els.modal.showModal();
}

function onModalCloseOnce(){
  markBusyTile(false);
  stopTimer();

  // NEU: Antwortbilder zuverlässig zurücksetzen
  resetAnswerImages();
}


function populatePlayerSelect(qid, starterId) {
  const tried = new Set((state.q[qid]?.attempts || []).map(a => a.playerId));
  const order = [
    ...(starterId ? [starterId] : []),
    ...state.players.map(p=>p.id).filter(id => id!==starterId)
  ];
  els.playerSelect.innerHTML = '';
  for (const pid of order) {
    if (tried.has(pid)) continue;
    const p = state.players.find(x=>x.id===pid);
    const opt = document.createElement('option'); opt.value=pid; opt.textContent=p.name;
    els.playerSelect.appendChild(opt);
  }
}

function updateAttemptInfo(qid) {
  const triedNames = (state.q[qid]?.attempts || []).map(a => idToName(a.playerId));
  els.attemptInfo.textContent = triedNames.length ? ("schon probiert: " + triedNames.join(", ")) : "";
}

function onResult(result) {
  const pid = els.playerSelect.value;
  if (!pid) return;
  const qid = current.id;
  const q = current.q;

  state.q[qid].attempts.push({ playerId: pid, result });
  pushHistory({ type:'ATTEMPT', qid, pid });

  if (result === 'correct') {
    addPoints(pid, q.points, {log:true});
    state.q[qid].winner = pid;
    fx('correct');
    finishQuestion(pid);
  } else {
    const penalty = Math.floor(q.points / 2);
    addPoints(pid, -penalty, {log:true});
    fx('wrong');

    const othersLeft = state.players.some(p => !state.q[qid].attempts.find(a => a.playerId === p.id));
    if (state.settings.allow_steal && othersLeft) {
      populatePlayerSelect(qid, state.q[qid].starter);
      updateAttemptInfo(qid);
      saveState(); sendSync(); sendScores(); return;
    } else {
      finishQuestion(null);
    }
  }
}

function finishQuestion(winnerId) {
  const qid = current.id;
  state.q[qid].status = 'resolved';
  state.used.add(qid);
  advanceTurn();
  pushHistory({ type:'RESOLVE', qid });

  // aktuelle Frage im State zurücksetzen
  state.current = null;
  state.audio = { playing:false, t:0, ts: Date.now() };

  saveState(); renderBoard(); renderOverlay();
  els.modal.close();

  send('RESOLVE_Q', { id: qid });
  sendScores(); sendTurn();
  sendSync();
}

function advanceTurn(){ if (state.players.length) state.turn = (state.turn + 1) % state.players.length; }

function removePlayer(idx){
  if (state.players.length<=1) return;
  const rem = state.players.splice(idx,1)[0];
  delete state.scores[rem.id];
  if (state.turn >= state.players.length) state.turn = 0;
  saveState(); renderPlayersBar(); renderOverlay(); sendSync();
}




function syncAudienceAudioFromState(){
  if (role !== 'screen') return;
  try{
    if (!els.qAud || els.qAud.hidden) return;
    const a = state.audio || { playing:false, t:0, ts:0 };
    // rechne die laufende Zeit aus Host-Startzeit hoch
    let t = Number(a.t||0);
    if (a.playing && a.ts) {
      t = t + (Date.now() - Number(a.ts)) / 1000;
    }
    if (Number.isFinite(t)) {
      // currentTime kann werfen, wenn metadata noch nicht geladen ist -> try/catch
      try{ els.qAud.currentTime = t; }catch(e){}
    }
    els.qAud.muted = false;
    if (a.playing) {
      els.qAud.play().catch(()=>{});
    } else {
      els.qAud.pause();
    }
  }catch(e){}
}

function applyCurrentForScreen() {
  if (role !== 'screen') return;
  const cur = state.current;
  // Wenn keine aktuelle Frage vorhanden, Modal schließen
  if (!cur || !cur.id) {
    try {
      if (els.modal && typeof els.modal.close === 'function' && els.modal.open) {
        els.modal.close();
      }
      if (els.timerBox) els.timerBox.hidden = true;
      resetAnswerImages();
    } catch (e) {}
    return;
  }

  // passende Frage zu dieser ID finden
  if (!data || !Array.isArray(data.categories)) return;
  let found = null;
  for (let c = 0; c < data.categories.length; c++) {
    const cat = data.categories[c];
    for (let r = 0; r < cat.questions.length; r++) {
      const q = cat.questions[r];
      if (!q) continue;
      const qid = q.id || `${c}-${r}`;
      if (qid === cur.id) {
        found = {
          id: qid,
          q: {
            cat: cat.title,
            points: q.points,
            text: q.text,
            answer: q.answer,
            image: q.image,
            image_reveal: q.image_reveal,
            audio: q.audio,
            video: q.video,
            answer_images: q.answer_images,
            ans1: q.ans1,
            ans2: q.ans2
          }
        };
        break;
      }
    }
    if (found) break;
  }
  if (!found) return;

  // Frage beim Publikum anzeigen
  showForAudience(found);
  syncAudienceAudioFromState();

  // Falls Antwort bereits aufgedeckt wurde, auch beim Publikum anzeigen
  if (cur.answerRevealed) {
    try {
      const base = (data.settings && data.settings.media_base) || 'media/';
      showAnswerImages(current.q || {}, base);
    } catch (e) {}
    els.answer.hidden = false;
  }
}

function setupRemoteListener() {
  if (role !== 'screen') return;
  if (!window.db) return;
  try {
    const roomRef = window.db.collection('rooms').doc(remoteRoomId);
    roomRef.onSnapshot(async (doc) => {
      if (!doc.exists) return;
      const raw = doc.data();
      if (!raw) return;

      let payload;
      if (raw.stateJson) {
        let stateRemote = {};
        try { stateRemote = JSON.parse(raw.stateJson || '{}'); } catch(e) { stateRemote = {}; }

        // Wenn der Screen kein Board-JSON hat, anhand boardUrl nachladen (wichtig bei neuem Tab/Device)
        let dataRemote = data;
        const boardUrl = raw.boardUrl;
        const needBoard = !!boardUrl && (!dataRemote || dataRemote._loadedFromUrl !== boardUrl);
        if (needBoard) {
          try {
            const res = await fetch(boardUrl, { cache: 'no-store' });
            if (res.ok) {
              dataRemote = await res.json();
              // Marker, damit wir nicht bei jedem Snapshot neu fetchen
              try { Object.defineProperty(dataRemote, '_loadedFromUrl', { value: boardUrl, enumerable: false }); }
              catch(e) { dataRemote._loadedFromUrl = boardUrl; }
              data = dataRemote;
              // Base für SFX/Media setzen (falls nötig)
              window.SFX_BASE = (data && data.settings && data.settings.media_base) || window.SFX_BASE || 'media/';
              if (!window.SFX_BASE.endsWith('/')) window.SFX_BASE += '/';
            }
          } catch (e) {
            console.warn('Board konnte nicht geladen werden:', boardUrl, e);
          }
        }

        payload = {
          state: stateRemote,
          data: dataRemote,
          boardUrl: boardUrl
        };
      } else {
        // Fallback für ältere Dokumente
        payload = raw;
      }

      handleMsg({ type: 'SYNC_STATE', payload });
    });
  } catch (e) {
    console.warn('Remote-Listener konnte nicht gestartet werden', e);
  }
}

/* ======= Publikum ======= */
function showForAudience(payload){
  const { id, q } = payload;
  current = { id, q };
  els.qCat.textContent = q.cat;
  els.qPts.innerHTML = `<span class="pos">+${q.points}</span> <span class="neg">-${Math.floor(q.points/2)}</span>`;
  els.qText.textContent = q.text || '';
  els.answer.textContent = q.answer || '—';
  els.answer.hidden = true;
  setMedia(q);
  resetAnswerImages();
  if (els.timerBox) els.timerBox.hidden = true;
  if (!els.qAud.hidden) { els.qAud.muted = true; els.qAud.play().catch(()=>{}); }
  els.modal.showModal();
}

/* ======= Timer ======= */
function startTimer(seconds){
  stopTimer();
  let t = seconds;
  els.timerBox.hidden = false;
  els.timerBox.textContent = t;
  send('TIMER', { seconds: t });
  timerInt = setInterval(() => {
    t--; els.timerBox.textContent = t; send('TIMER', { seconds: t });
    if (t <= 0) stopTimer();
  }, 1000);
}
function showTimer(t){
  if (t <= 0){ document.querySelectorAll('.timerbox').forEach(e=>e.hidden=true); return; }
  els.timerBox.hidden = false; els.timerBox.textContent = t;
}
function stopTimer(){
  if (timerInt){ clearInterval(timerInt); timerInt = null; }
  els.timerBox.hidden = true; send('TIMER', { seconds: 0 });
}

/* ======= Gemeinsames ======= */
function playSfx(kind, opts) {
  try {
    // 1) Nimm gecachte Base, sonst aus data.settings, sonst 'media/'
    let base = (window.SFX_BASE || (data && data.settings && data.settings.media_base) || 'media/');
    if (!base.endsWith('/')) base += '/';
    // 2) Cache die Base, sobald wir eine haben
    window.SFX_BASE = base;

    const src = (kind === 'correct') ? base + 'correct.mp3' : base + 'wrong.mp3';

    // bevorzugt DOM-Audios, falls vorhanden
    const tagId = (kind === 'correct') ? 'sfxCorrect' : 'sfxWrong';
    const tag = document.getElementById(tagId);

    if (tag) {
      tag.src = src;
      if (opts && opts.prime) {
        tag.muted = true;
        tag.play().then(() => { try { tag.pause(); tag.currentTime = 0; tag.muted = false; } catch(e){} });
      } else {
        tag.muted = false;
        try { tag.currentTime = 0; } catch(e) {}
        tag.play().catch(() => {});
      }
      return;
    }

    // Fallback: dynamischer Audio-Knoten
    const a = new Audio(src);
    if (opts && opts.prime) {
      a.muted = true;
      a.play().then(() => { try { a.pause(); a.currentTime = 0; a.muted = false; } catch(e){} });
    } else {
      a.muted = false;
      a.play().catch(() => {});
    }
  } catch (e) {}
}


function resetAnswerImages(){
  if (!els.answerImages) return;
  els.answerImages.hidden = true;
  els.answerImages.classList.remove('single');
  if (els.ansImg1) { els.ansImg1.src = ''; els.ansImg1.hidden = true; }
  if (els.ansImg2) { els.ansImg2.src = ''; els.ansImg2.hidden = true; }
}

function showAnswerImages(q, base='media/'){
  resetAnswerImages();
  if (!q || !els.answerImages) return;

  let sources = [];
  if (Array.isArray(q.answer_images)) {
    sources = q.answer_images.filter(Boolean);
  } else if (q.ans1 || q.ans2) {
    sources = [q.ans1, q.ans2].filter(Boolean);
  } else if (q.answer_image) {
    sources = [q.answer_image];
  }

  sources = sources.slice(0, 2);
  if (sources.length === 0) return;

  if (els.ansImg1) {
    els.ansImg1.src = base + sources[0];
    els.ansImg1.hidden = false;
  }
  if (els.ansImg2) {
    if (sources.length >= 2) {
      els.ansImg2.src = base + sources[1];
      els.ansImg2.hidden = false;
    } else {
      els.ansImg2.src = '';
      els.ansImg2.hidden = true;
    }
  }

  els.answerImages.classList.toggle('single', sources.length === 1);
  els.answerImages.hidden = false;
}

function showAnswerImagesForCurrent(){
  try {
    const base = (data.settings && data.settings.media_base) || 'media/';
    showAnswerImages((current && current.q) ? current.q : null, base);
  } catch (e) {}
}

function setMedia(q){
  const base = (data.settings && data.settings.media_base) || 'media/';
  els.qImg.hidden = els.qAud.hidden = els.qVid.hidden = true;
  if (q.image){ els.qImg.src = base + q.image; els.qImg.hidden = false; els.qImg.dataset.alt='pixel'; }
  if (q.audio){ els.qAud.src = base + q.audio; els.qAud.hidden = false; }
  if (q.video){ els.qVid.src = base + q.video; els.qVid.hidden = false; }
}

function addPoints(pid, delta, {log=false}={}){
  state.scores[pid] = (state.scores[pid] || 0) + Number(delta);
  const p = state.players.find(x => x.id === pid);
  if (p && p._scoreEl) p._scoreEl.textContent = state.scores[pid];
  renderOverlay();
  if (log) pushHistory({ type:'POINTS', pid, delta });
  saveState(); sendScores();
}

function markBusyTile(isBusy) {
  const { col, row } = current;
  if (col < 0) return;
  const idx = data.categories.length + (row * data.categories.length) + col;
  const tile = els.board.children[idx];
  if (!tile) return;
  tile.classList.toggle('busy', isBusy);
}

/* ======= Speicher ======= */
function saveState() {
  const payload = {
    players: state.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar || null, jokers: p.jokers })),
    scores: state.scores,
    q: {},
    used: Array.from(state.used),
    settings: state.settings,
    turn: state.turn,
    current: state.current,
    audio: state.audio
  };
  localStorage.setItem('quiz_state', JSON.stringify(payload));
}
function loadState() {
  const raw = localStorage.getItem('quiz_state');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (s.players) state.players = s.players;
    state.scores = s.scores || state.scores;
    state.q = s.q || {};
    state.used = new Set(s.used || []);
    state.turn = s.turn || 0;
    state.current = s.current || null;
    state.audio = s.audio || state.audio || { playing:false, t:0, ts:0 };
  } catch {}
}

/* ======= Undo (History) ======= */
function pushHistory(entry){
  state.history.push(entry);
  if (state.history.length > 50) state.history.shift();
}
function undo(){
  const h = state.history.pop(); if (!h) return;
  switch(h.type){
    case 'POINTS': addPoints(h.pid, -h.delta, {log:false}); break;
    case 'RESOLVE':
      if (state.q[h.qid]) state.q[h.qid].status = 'open';
      state.used.delete(h.qid);
      saveState(); renderBoard(); renderOverlay(); sendSync(); break;
    case 'ATTEMPT':
      const a = state.q[h.qid]?.attempts; if (Array.isArray(a) && a.length) a.pop();
      saveState(); sendSync(); break;
  }
}

/* ======= Helper & Global ======= */
function idToName(pid){ return state.players.find(p => p.id === pid)?.name || pid; }
function sendSync() {
  // KEINE DOM-Elemente mitschicken (z. B. _scoreEl entfernen)
  const cleanPlayers = state.players.map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar || null,
    jokers: p.jokers || {}
  }));

  const stateForWire = {
    players: cleanPlayers,
    scores: state.scores,
    q: {},
    used: Array.from(state.used),
    settings: state.settings,
    turn: state.turn,
    current: state.current,
    audio: state.audio
  };

  const payload = {
    state: stateForWire,
    data
  };

  // lokal an andere Tabs (selber Browser)
  send('SYNC_STATE', payload);

  // remote an Firestore, falls verfügbar
  if (role === 'host' && window.db) {
    try {
      const roomRef = window.db.collection('rooms').doc(remoteRoomId);
      const docData = {
        stateJson: JSON.stringify(stateForWire),
        boardUrl: localStorage.getItem("quiz_board_file"),
        updatedAt: Date.now()
      };
      roomRef.set(docData);
    } catch (e) {
      console.warn('Remote-Sync fehlgeschlagen', e);
    }
  }
}
function sendScores(){ send('SCORES', { scores: state.scores }); }
function sendTurn(){ send('TURN', { turn: state.turn }); }
function fx(type){
  if(!els.fx)return;
  if(role==='host'){ send('FX',{type}); }
  els.fx.style.background= type==='correct'?'rgba(63,191,108,.25)':'rgba(255,92,116,.25)';
  els.fx.classList.remove('show'); void els.fx.offsetWidth; els.fx.classList.add('show');
  playSfx(type);
}

function attachGlobalHandlers() {
  if (els.boardSelect && role === 'host') {
    els.boardSelect.onchange = async (e) => {
      const id = e.target.value;
      const board = boards.find(b => b.id === id);
      if (!board) return;
      await loadBoardFromUrl(board.url);
    };
  }

  if (els.presentBtn && role === 'host') {
    els.presentBtn.onclick = () => window.open(`${location.pathname}?view=screen`, 'quiz-screen', 'width=1280,height=800');
  }
  if (els.addPlayerBtn && role==='host'){
    els.addPlayerBtn.onclick = () => {
      const id = `p${state.players.length+1}`;
      state.players.push({ id, name:`Spieler ${state.players.length+1}`, avatar:null, jokers:{j1:true,j2:true,j3:true} });
      state.scores[id] = 0;
      saveState(); renderPlayersBar(); renderOverlay(); sendSync();
    };
  }
  if (els.undoBtn && role==='host'){
    els.undoBtn.onclick = () => undo();
    window.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase()==='z') undo(); });
  }

  els.resetBtn.onclick = () => {
    if (role !== 'host') return;
    if (!confirm('Spielstand wirklich löschen?')) return;
    for (const p of state.players) state.scores[p.id] = 0;
    state.q = {}; state.used = new Set(); state.history = []; state.turn = 0;
    saveState(); renderPlayersBar(); renderBoard(); renderOverlay(); sendSync();
  };
  if (els.roundResetBtn && role==='host'){
    els.roundResetBtn.onclick = () => {
      if (!confirm('Nur das Board leeren (Punkte/Spieler bleiben)?')) return;
      state.q = {}; state.used = new Set(); state.history = [];
      saveState(); renderBoard(); sendSync();
    };
  }

  els.exportBtn.onclick = () => {
    const blob = new Blob([localStorage.getItem('quiz_state') || '{}'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `quiz_state_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    a.click();
  };

  els.importBtn.onclick = () => els.importFile.click();
  els.importFile.onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    localStorage.setItem('quiz_state', text);
    loadState(); renderPlayersBar(); renderBoard(); renderOverlay(); sendSync();
  };

  els.loadBtn.onclick = () => els.loadFile.click();
  els.loadFile.onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    await loadContent(text);
    state.q = {}; state.used = new Set(); state.history = []; state.turn = 0;
    for (const p of state.players) state.scores[p.id] = 0;
    saveState(); renderPlayersBar(); renderBoard(); renderOverlay(); sendSync();
  };

  // Shortcuts nur für Host & nur im Modal
  window.addEventListener('keydown', (ev) => {
    if (role !== 'host' || !els.modal.open) return;
    if (ev.key === 'a') {
      els.revealBtn.click();
    }
    if (ev.key.toLowerCase() === 'r') els.correctBtn.click();
    if (ev.key.toLowerCase() === 'f') els.wrongBtn.click();
    if (ev.key.toLowerCase() === 's') els.skipBtn.click();
    if (/^[1-8]$/.test(ev.key)) {
      const idx = Number(ev.key) - 1;
      const opt = els.playerSelect.options[idx];
      if (opt) els.playerSelect.value = opt.value;
    }
  });
}
