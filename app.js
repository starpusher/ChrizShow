/* ======= Rollen & Broadcast ======= */
const params = new URLSearchParams(location.search);

const HOST_SECRET = '314159';

const requestedView = params.get('view');
let __authFailed = false;
let role = requestedView || 'screen';  // 'host' | 'screen' | 'editor'
if (role === 'host' || role === 'editor') {
  const key = params.get('key');
  if (key !== HOST_SECRET) {
    // Falscher oder fehlender Schlüssel → auf Screen-Ansicht zurückfallen
    role = 'screen';
    __authFailed = true;
  }
}
if (role === 'screen') document.body.classList.add('audience');
if (role === 'editor') document.body.classList.add('editor');

const remoteRoomId = params.get('room') || 'default';

// Avatare nicht im Firestore-State speichern (1MB-Limit). Stattdessen separate Avatar-Dokumente.
let __avatarCache = {};            // playerId -> dataURL
let __avatarUnsub = null;

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
    case 'FX': {
      const t = (payload && payload.ts) ? Number(payload.ts) : Date.now();
      if (t > __lastFxTs) { __lastFxTs = t; fxLocal((payload&&payload.type)||'correct'); }
      break;
    }
    case 'SHOW_Q': showForAudience(payload); break;
    case 'REVEAL_ANSWER':
      resetAnswerImages();
      showAnswerImagesForCurrent();
      showAnswerMediaForCurrent();
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
      if (!els.qAud.hidden){ els.qAud.muted = false; try{ els.qAud.currentTime = payload.t||0; }catch(e){} } break;
    case 'AUDIO_PLAY':
      if (!els.qAud.hidden){ els.qAud.muted = false; els.qAud.play().catch(()=>{}); } break;
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
      const __prevPlayers = Array.isArray(state.players) ? state.players.map(p=>({id:p.id, jokers:{...(p.jokers||{})}})) : [];
      data = payload.data;
      window.SFX_BASE = (payload.data && payload.data.settings && payload.data.settings.media_base) || window.SFX_BASE || 'media/';
      if (!window.SFX_BASE.endsWith('/')) window.SFX_BASE += '/';
      Object.assign(state, { players: payload.state.players, scores: payload.state.scores, q: payload.state.q||{}, settings: payload.state.settings||{}, turn: payload.state.turn||0, current: payload.state.current || null, audio: payload.state.audio || state.audio, fxPulse: payload.state.fxPulse || state.fxPulse, timer: payload.state.timer || state.timer });
      state.used = new Set(payload.state.used || []);

      // Avatare aus separater Sync-Quelle anwenden
      __applyAvatarCache();

      // Publikum (remote): Joker-Animation auch ohne BroadcastChannel auslösen.
      if (role === 'screen') {
        try {
          const prev = {};
          (__prevPlayers || []).forEach(p => { prev[p.id] = p.jokers || {}; });
          (state.players || []).forEach(p => {
            const pj = prev[p.id] || {};
            ['j1','j2','j3'].forEach(k => {
              if (pj[k] === true && (p.jokers && p.jokers[k] === false)) {
                showJokerFx({ jokerKey: k, playerId: p.id });
              }
            });
          });
        } catch(e) {}
      }


      // Publikum: FX (Richtig/Falsch) auch remote über Sync auslösen
      try {
        const fp = payload.state && payload.state.fxPulse;
        if (fp && fp.ts && Number(fp.ts) > __lastFxTs) {
          __lastFxTs = Number(fp.ts);
          fxLocal(fp.type || 'correct');
        }
      } catch(e) {}
      renderPlayersBar(true); renderBoard(); renderOverlay();
      applyCurrentForScreen();
      try{ showTimer((state.timer && state.timer.seconds) ? state.timer.seconds : 0); }catch(e){}
      syncAudienceAudioFromState();
      break;
  }
}
if (role === 'screen') chan.postMessage({ type: 'SCREEN_READY' });
// unlock sfx after first interaction on audience
if (role==='screen'){
  const __unlock = ()=>{
    try{ playSfx('correct',{prime:true}); playSfx('wrong',{prime:true}); }catch(e){}
    // Audio in der Publikums-Ansicht erst nach User-Interaktion freischalten (Browser-Autoplay-Regeln)
    window.__audUnlocked = true;
    try{ if (els.qAud) els.qAud.muted = false; }catch(e){}
    try{ syncAudienceAudioFromState(); }catch(e){}
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
  ansAud: document.getElementById('ansAud'),
  ansVid: document.getElementById('ansVid'),
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
  ansImg2: document.getElementById('ansImg2'),
  editorBtn: document.getElementById('editorBtn'),
  refreshBoardsBtn: document.getElementById('refreshBoardsBtn'),
  editorPage: document.getElementById('editorPage'),
  editorTitle: document.getElementById('editorTitle'),
  editorBoards: document.getElementById('editorBoards'),
  editorBoardType: document.getElementById('editorBoardType'),
  editorBoardName: document.getElementById('editorBoardName'),
  editorSaveBtn: document.getElementById('editorSaveBtn'),
  editorSaveAsBtn: document.getElementById('editorSaveAsBtn'),
  editorLoadBtn: document.getElementById('editorLoadBtn'),
  editorNewBtn: document.getElementById('editorNewBtn'),
  editorExportJson: document.getElementById('editorExportJson'),
  editorRefreshBoards: document.getElementById('editorRefreshBoards'),
  editorFormHost: document.getElementById('editorFormHost')
};

/* ======= Image Lightbox (Dialog, toggle) ======= */
let __imgLightbox = null;
function ensureImgLightbox(){
  if (__imgLightbox) return __imgLightbox;
  const dlg = document.getElementById('imgLightbox');
  const img = document.getElementById('imgLightboxImg');
  if (!dlg || !img) return null;
  __imgLightbox = { dlg, img };

  const close = () => { try{ dlg.close(); }catch(e){} try{ img.src=''; }catch(e){} };

  dlg.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dlg.open) close();
  });

  return __imgLightbox;
}

function toggleLightboxFromImg(el){
  try{
    const lb = ensureImgLightbox(); if (!lb) return;
    if (lb.dlg.open) { lb.dlg.close(); lb.img.src=''; return; }
    if (!el || el.hidden) return;
    const src = el.currentSrc || el.src;
    if (!src) return;
    lb.img.src = src;
    lb.dlg.showModal();
  }catch(e){}
}


catch(e){}
}



// Audience Audio: bei großen MP3s dauert "metadata/canplay" länger.
// Wir syncen deshalb nach dem Laden nochmal und starten ggf. neu.
let __audBindDone = false;
function bindAudienceAudioEventsOnce(){
  if (__audBindDone) return;
  __audBindDone = true;
  if (!els.qAud) return;
  const onMeta = () => { try{ syncAudienceAudioFromState(); }catch(e){} };
  const onCanPlay = () => { 
    try{
      if (role==='screen' && window.__audUnlocked) {
        const a = state.audio || {};
        if (a.playing) els.qAud.play().catch(()=>{});
      }
    }catch(e){}
  };
  els.qAud.addEventListener('loadedmetadata', onMeta);
  els.qAud.addEventListener('canplay', onCanPlay);
}

/* ======= Joker-FX (Publikum) ======= */
function ensureJokerFxEl(){
  // The FX element must be able to render above an open <dialog>.
  // <dialog> is in the browser "top layer" → normal z-index cannot exceed it.
  // So: if a dialog is open, mount the FX *inside* the dialog; otherwise mount to <body>.
  let fx = document.getElementById("jokerFx");
  if (!fx){
    fx = document.createElement("div");
    fx.id = "jokerFx";
    fx.innerHTML = `
      <div class="jokerfx-box">
        <div class="jokerfx-label">JOKER</div>
        <div class="jokerfx-icon">★</div>
      </div>
    `;
  }

  const openDialog = document.querySelector("dialog[open]");
  const mountTarget = openDialog || document.body;

  if (fx.parentElement !== mountTarget){
    try { fx.remove(); } catch(e){}
    mountTarget.appendChild(fx);
  }
  return fx;
}

function showJokerFx({ jokerKey, playerId }={}){
  if (role !== 'screen') return;

  const fx = ensureJokerFxEl();
  const labelEl = fx.querySelector('.jokerfx-label');
  const iconEl  = fx.querySelector('.jokerfx-icon');

  const meta = {
    j1: { title: 'SCHIEBE-JOKER', icon: '⇄' },
    j2: { title: 'RISIKO-JOKER',  icon: '🎲' },
    j3: { title: 'TELEFON-JOKER', icon: '☎️' }
  };
  const m = meta[jokerKey] || { title:'JOKER', icon:'★' };

  const pname = (state.players || []).find(p => p.id === playerId)?.name;
  if (labelEl) labelEl.textContent = pname ? `${m.title} • ${pname}` : m.title;
  if (iconEl)  iconEl.textContent  = m.icon;

  // retrigger animation on #jokerFx (CSS listens on #jokerFx.show)
  fx.classList.remove('show');
  void fx.offsetWidth;
  fx.classList.add('show');

  try { if (navigator.vibrate) navigator.vibrate(30); } catch(e){}
}

function ensureAudienceVolumeUI(){
  if (role !== 'screen') return;
  if (!els.qAud) return;

  // Native Controls aus (damit niemand starten/skippen/download/speed ändern kann)
  try{
    els.qAud.controls = false;
    els.qAud.setAttribute('controlsList','nodownload noplaybackrate noremoteplayback');
    els.qAud.setAttribute('disablepictureinpicture','');
  }catch(e){}

  let box = document.getElementById('audVolBox');
  if (box) return box;

  box = document.createElement('div');
  box.id = 'audVolBox';
  box.style.display = 'none';
  box.style.margin = '10px auto 0';
  box.style.maxWidth = '520px';
  box.style.width = '92%';

  const label = document.createElement('div');
  label.textContent = 'Lautstärke';
  label.style.opacity = '.9';
  label.style.fontWeight = '700';
  label.style.marginBottom = '6px';
  label.style.textAlign = 'center';

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '10px';
  row.style.justifyContent = 'center';

  const icon = document.createElement('span');
  icon.textContent = '🔊';
  icon.style.fontSize = '18px';

  const rng = document.createElement('input');
  rng.type = 'range';
  rng.min = '0';
  rng.max = '1';
  rng.step = '0.01';
  rng.value = String(Number(localStorage.getItem('aud_volume') ?? '0.9'));
  rng.style.width = '240px';

  const pct = document.createElement('span');
  pct.style.minWidth = '44px';
  pct.style.textAlign = 'right';
  pct.style.opacity = '.85';

  const apply = () => {
    const v = Math.max(0, Math.min(1, Number(rng.value)));
    pct.textContent = Math.round(v*100) + '%';
    try{ els.qAud.volume = v; }catch(e){}
    localStorage.setItem('aud_volume', String(v));
  };
  rng.addEventListener('input', apply);
  apply();

  row.append(icon, rng, pct);
  box.append(label, row);

  const modalForm = document.querySelector('#qModal .modal');
  if (modalForm) {
    try{ modalForm.appendChild(box); }catch(e){}
  } else {
    document.body.appendChild(box);
  }
  return box;
}

/* ======= Audio-Gate (Publikum) ======= */

function ensureAudioGateEl(){
  let root = document.getElementById('audioGate');
  if (root) return root;

  root = document.createElement('div');
  root.id = 'audioGate';
  root.className = 'audio-gate';
  root.innerHTML = `
    <div class="audio-gate-box">
      <div class="audio-gate-title">Sound aktivieren</div>
      <div class="audio-gate-sub">Tippe/Klicke einmal, damit Audio &amp; Effekte im Browser abgespielt werden dürfen.</div>
      <div class="audio-gate-icon">🔊</div>
      <div class="audio-gate-hint">(Danach bleibt der Sound an.)</div>
    </div>
  `;

  root.addEventListener('click', () => {
    window.__audUnlocked = true;

    // Gate ausblenden
    root.classList.remove('show');
    root.setAttribute('hidden','');

    // Audios entsperren
    try{ if (els.qAud) els.qAud.muted = false; }catch(e){}

    // direkt den aktuellen State anwenden
    try{ syncAudienceAudioFromState(); }catch(e){}

    // Wenn der Host gerade "playing" hat, nochmal aktiv play() versuchen
    try{
      const a = state.audio || {};
      if (a.playing && els.qAud && !els.qAud.hidden) {
        els.qAud.muted = false;
        els.qAud.play().catch(()=>{});
      }
    }catch(e){}

    // SFX-Test (kurz) – wenn es geblockt wäre, merkt man das sofort.
    try{ playSfx('correct'); }catch(e){}
  });

  // In das Modal einhängen, damit es auch über einem offenen <dialog> sichtbar ist
  const modalForm = document.querySelector('#qModal .modal');
  if (modalForm) {
    try{ modalForm.style.position = modalForm.style.position || 'relative'; }catch(e){}
    modalForm.appendChild(root);
  } else {
    document.body.appendChild(root);
  }
  return root;
}

function showAudioGateIfNeeded(q){
  if (role !== 'screen') return;
  if (window.__audUnlocked) return;
  if (!q || !q.audio) return;

  const gate = ensureAudioGateEl();
  gate.removeAttribute('hidden');

  // retrigger (pop) animation
  gate.classList.remove('show');
  void gate.offsetWidth;
  gate.classList.add('show');
}



function normalizeQuestions(d){
  try{
    if (!d || !Array.isArray(d.categories)) return;
    d.categories.forEach(cat=>{
      if (!cat || !Array.isArray(cat.questions)) return;
      cat.questions.forEach(q=>{
        if (!q) return;
        // Support legacy keys
        if (q.text == null && q.question != null) q.text = q.question;
        if (q.answer == null && q.solution != null) q.answer = q.solution;
      });
    });
  }catch(e){}
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
let __screenShownId = null; // Publikum: zuletzt gerenderte Frage, um Media-Reloads zu vermeiden

let timerInt = null;
let __lastFxTs = 0;


/* ======= Editor (Boards erstellen/bearbeiten) ======= */
const LOCAL_BOARDS_KEY = 'quiz_local_boards_v1'; // array of {name, savedAt}
function getLocalBoards(){ try{ return JSON.parse(localStorage.getItem(LOCAL_BOARDS_KEY) || '[]') || []; }catch(e){ return []; } }
function setLocalBoards(list){ try{ localStorage.setItem(LOCAL_BOARDS_KEY, JSON.stringify(list||[])); }catch(e){} }
function localBoardStorageKey(name){ return 'quiz_board_local__' + String(name||'').trim(); }
function saveBoardToLocal(name, jsonText){
  name = String(name||'').trim();
  if (!name) return false;
  try{
    localStorage.setItem(localBoardStorageKey(name), jsonText);
    const list = getLocalBoards();
    const now = Date.now();
    const idx = list.findIndex(x => x && x.name === name);
    if (idx >= 0) list[idx].savedAt = now;
    else list.push({ name, savedAt: now });
    setLocalBoards(list);
    return true;
  }catch(e){ return false; }
}
function loadBoardFromLocal(name){ try{ return localStorage.getItem(localBoardStorageKey(name)) || null; }catch(e){ return null; } }

let __editorLoadedUrl = null;
function editorPointsForRow(row, boardType){ return (boardType==='board2' ? [200,400,600,800,1000] : [100,200,300,400,500])[row] || 100; }
function editorEnsureDefaults(){
  if (!data || !data.categories) data = { settings:{ media_base:'media/', allow_steal:true }, players:['Spieler 1','Spieler 2','Spieler 3'], categories:[] };
  if (!data.settings) data.settings = { media_base:'media/', allow_steal:true };
  if (!Array.isArray(data.players)) data.players = ['Spieler 1','Spieler 2','Spieler 3'];
  if (!Array.isArray(data.categories)) data.categories = [];
}
function stripExt(name){ return (name||'').replace(/\.(jpg|mp3|mp4)$/i,''); }
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function editorNewBoard(){
  editorEnsureDefaults();
  const bt = els.editorBoardType?.value || 'board1';
  if (bt === 'between') {
    data.categories = [{
      title: 'Zwischenboard',
      questions: Array.from({length:5},(_,r)=>({ id:`Q-1${r+1}`, points:200, text:'', answer:'', type:'' }))
    }];
  } else {
    data.categories = Array.from({length:5}, (_,c)=>({
      title:`Kategorie ${c+1}`,
      questions:Array.from({length:5},(_,r)=>({ id:`Q-${c+1}${r+1}`, points:editorPointsForRow(r,bt), text:'', answer:'', type:'' }))
    }));
  }
  __editorLoadedUrl=null;
  if (els.editorBoardName) els.editorBoardName.value = '';
  renderEditor();
}
async function editorLoadSelected(){
  const url = els.editorBoards?.value; if(!url) return;
  __editorLoadedUrl=url;
  await loadContent(url);
  renderEditor();
}
function editorBuildFromForm(){
  editorEnsureDefaults();
  const bt = els.editorBoardType?.value || 'board1';
  const cats=[];
  (els.editorPage?.querySelectorAll('[data-cat]')||[]).forEach((catEl,ci)=>{
    const title=catEl.querySelector('input[data-field="cat-title"]')?.value?.trim()||`Kategorie ${ci+1}`;
    const questions=[];
    catEl.querySelectorAll('tr[data-row]').forEach((rowEl,ri)=>{
      const qtext=rowEl.querySelector('textarea[data-field="q-text"]')?.value?.trim()||'';
      const qType=rowEl.querySelector('select[data-field="q-type"]')?.value||'text';
      const qFile=rowEl.querySelector('input[data-field="q-file"]')?.value?.trim()||'';

      const atext=rowEl.querySelector('textarea[data-field="a-text"]')?.value?.trim()||'';
      const aType=rowEl.querySelector('select[data-field="a-type"]')?.value||'text';
      const a1=rowEl.querySelector('input[data-field="a-file1"]')?.value?.trim()||'';
      const a2=rowEl.querySelector('input[data-field="a-file2"]')?.value?.trim()||'';

      const ptsVal = Number(rowEl.querySelector('input[data-field="pts"]')?.value);
      const ptsDefault = (bt==='between') ? 200 : editorPointsForRow(ri,bt);

      const isEst = !!rowEl.querySelector('input[data-field="is-estimate"]')?.checked;

      const q={ id:`Q-${ci+1}${ri+1}`, points: (Number.isFinite(ptsVal) && ptsVal>0) ? ptsVal : ptsDefault };

      if(qtext) q.text=qtext;
      if(atext) q.answer=atext;

      if (isEst) q.type = 'estimate';

      if(qType==='image'&&qFile) q.image=(qFile.endsWith('.jpg')?qFile:qFile+'.jpg');
      if(qType==='mp3'&&qFile) q.audio=(qFile.endsWith('.mp3')?qFile:qFile+'.mp3');
      if(qType==='mp4'&&qFile) q.video=(qFile.endsWith('.mp4')?qFile:qFile+'.mp4');

      if(aType==='img1'&&a1) q.answer_images=[(a1.endsWith('.jpg')?a1:a1+'.jpg')];
      if(aType==='img2'&&a1&&a2) q.answer_images=[(a1.endsWith('.jpg')?a1:a1+'.jpg'), (a2.endsWith('.jpg')?a2:a2+'.jpg')];
      if(aType==='mp3'&&a1) q.answer_audio=(a1.endsWith('.mp3')?a1:a1+'.mp3');
      if(aType==='mp4'&&a1) q.answer_video=(a1.endsWith('.mp4')?a1:a1+'.mp4');

      questions.push(q);
    });
    cats.push({ title, questions });
  });
  data.categories=cats;
  return data;
}
function editorSave(asNew=false){
  const nameInput = (els.editorBoardName && els.editorBoardName.value) ? els.editorBoardName.value.trim() : '';
  let name = nameInput;
  if (!name) {
    if (!asNew && __editorLoadedUrl) {
      name = (__editorLoadedUrl.startsWith('local:') ? __editorLoadedUrl.slice(6) : (__editorLoadedUrl.split('/').pop()||'').replace(/\.json$/,''));
    }
  }
  if (!name) { alert('Bitte Board-Name eingeben.'); return; }

  const out = editorBuildFromForm();
  const jsonText = JSON.stringify(out, null, 2);
  const ok = saveBoardToLocal(name, jsonText);
  if (!ok) { alert('Konnte nicht speichern (localStorage voll oder blockiert).'); return; }

  __editorLoadedUrl = 'local:' + name;
  loadBoardsList().then(()=>{ renderEditor(); }).catch(()=>{ renderEditor(); });
  alert(`✅ Gespeichert als LOCAL • ${name}`);
}

function editorExport(){
  const out=editorBuildFromForm();
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  const base=(__editorLoadedUrl?__editorLoadedUrl.split('/').pop().replace(/\.json$/,''):'board');
  a.download=`${base}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}
function renderEditor(){
  if(role!=='editor') return;
  editorEnsureDefaults();
  if(els.board) els.board.style.display='none';
  if(els.overlay) els.overlay.style.display='none';
  if(els.playersBar) els.playersBar.style.display='none';
  const controls=document.querySelector('.controls'); if(controls) controls.style.display='none';
  if(els.editorPage) els.editorPage.hidden=false;
  if(els.editorBoards){
    els.editorBoards.innerHTML='<option value="">Board wählen…</option>';
    (boards||[]).forEach(b=>{ const o=document.createElement('option'); o.value=b.url; o.textContent=b.label||b.url; if(__editorLoadedUrl&&b.url===__editorLoadedUrl) o.selected=true; els.editorBoards.appendChild(o); });
  }
  if(els.editorTitle) els.editorTitle.textContent=__editorLoadedUrl?`Bearbeite: ${__editorLoadedUrl}`:'Neues Board (nicht gespeichert)';
  try{
    if (els.editorBoardName && (!els.editorBoardName.value || __editorLoadedUrl)) {
      const nameGuess = (__editorLoadedUrl||'').startsWith('local:') ? (__editorLoadedUrl.slice(6)) : (__editorLoadedUrl||'').split('/').pop()?.replace(/\.json$/,'');
      if (nameGuess) els.editorBoardName.value = nameGuess;
    }
  }catch(e){}
  const host=document.getElementById('editorFormHost'); if(!host) return;
  host.innerHTML='';
  const bt=els.editorBoardType?.value||'board1';
  data.categories.forEach((cat,ci)=>{
    const wrap=document.createElement('div'); wrap.className='editor-cat'; wrap.dataset.cat=String(ci);
    wrap.innerHTML=`<div class="editor-cat-head"><label>Kategorie ${ci+1}:</label><input data-field="cat-title" value="${escapeHtml(cat.title||'')}" /></div><div class="editor-tablewrap"><table class="editor-table"><thead><tr><th>Punkte</th><th>Schätzfrage</th><th>Frage</th><th>Frage-Medium</th><th>Datei</th><th>Antwort</th><th>Antwort-Medium</th><th>Datei 1</th><th>Datei 2</th></tr></thead><tbody></tbody></table></div>`;
    const tbody=wrap.querySelector('tbody');
    const qs=Array.isArray(cat.questions)?cat.questions:[];
    for(let ri=0;ri<5;ri++){
      const q=qs[ri]||{};
      const pts=editorPointsForRow(ri,bt);
      const qType=q.image?'image':(q.audio?'mp3':(q.video?'mp4':'text'));
      const qFile=q.image||q.audio||q.video||'';
      let aType='text', f1='', f2='';
      if(Array.isArray(q.answer_images)&&q.answer_images.length===1){aType='img1'; f1=q.answer_images[0]||'';}
      if(Array.isArray(q.answer_images)&&q.answer_images.length>=2){aType='img2'; f1=q.answer_images[0]||''; f2=q.answer_images[1]||'';}
      if(q.answer_audio){aType='mp3'; f1=q.answer_audio;}
      if(q.answer_video){aType='mp4'; f1=q.answer_video;}
      const tr=document.createElement('tr'); tr.dataset.row=String(ri);
      tr.innerHTML=`<td class="pts"><input data-field="pts" type="number" min="0" step="1" value="${(q.points||pts)}" /></td><td style="text-align:center"><input data-field="is-estimate" type="checkbox" ${((q.type==='estimate'||q.estimate===true)?'checked':'')} /></td><td><textarea data-field="q-text" rows="2">${escapeHtml(q.text||'')}</textarea></td><td><select data-field="q-type"><option value="text"${qType==='text'?' selected':''}>Text</option><option value="image"${qType==='image'?' selected':''}>Bild (.jpg)</option><option value="mp3"${qType==='mp3'?' selected':''}>MP3 (.mp3)</option><option value="mp4"${qType==='mp4'?' selected':''}>MP4 (.mp4)</option></select></td><td><input data-field="q-file" value="${escapeHtml(stripExt(qFile))}" placeholder="Dateiname ohne Endung" /></td><td><textarea data-field="a-text" rows="2">${escapeHtml(q.answer||'')}</textarea></td><td><select data-field="a-type"><option value="text"${aType==='text'?' selected':''}>Text</option><option value="img1"${aType==='img1'?' selected':''}>1 Bild (.jpg)</option><option value="img2"${aType==='img2'?' selected':''}>2 Bilder (.jpg)</option><option value="mp3"${aType==='mp3'?' selected':''}>MP3 (.mp3)</option><option value="mp4"${aType==='mp4'?' selected':''}>MP4 (.mp4)</option></select></td><td><input data-field="a-file1" value="${escapeHtml(stripExt(f1))}" placeholder="Dateiname ohne Endung" /></td><td><input data-field="a-file2" value="${escapeHtml(stripExt(f2))}" placeholder="nur bei 2 Bildern" /></td>`;
      tbody.appendChild(tr);
    }
    host.appendChild(wrap);
  });
  host.querySelectorAll('select[data-field="a-type"]').forEach(sel=>{
    const upd=()=>{ const tr=sel.closest('tr'); const file2=tr?.querySelector('input[data-field="a-file2"]'); if(!file2) return; file2.disabled=(sel.value!=='img2'); if(sel.value!=='img2') file2.value=''; };
    sel.addEventListener('change', upd); upd();
  });
}
/* ======= Init ======= */
init();
async function init() {
  if (role === 'host' || role === 'editor') {
    await loadBoardsList();               // optional: lädt data/boards.json, falls vorhanden
    const startUrl = getInitialBoardUrl();
    await loadContent(startUrl);
  } else {
    // Screen lädt kein eigenes JSON, sondern wartet auf Sync vom Host
  }
  loadState();

  // Wenn jemand Host/Editor aufruft ohne richtigen Key, kurz Hinweis geben
  if (__authFailed && (requestedView === 'host' || requestedView === 'editor')) {
    alert('Falscher oder fehlender Key. Nutze z.B. ?view=host&key=314159 oder ?view=editor&key=314159');
  }

  // Bild in Modal per Klick vergrößern (Host & Publikum)
  if (els.qImg) els.qImg.addEventListener('click', () => toggleLightboxFromImg(els.qImg));
  const a1 = document.getElementById('ansImg1');
  const a2 = document.getElementById('ansImg2');
  if (a1) a1.addEventListener('click', () => toggleLightboxFromImg(a1));
  if (a2) a2.addEventListener('click', () => toggleLightboxFromImg(a2));

  // Publikum: Kontextmenü auf Media sperren (Download-Menü etc.)
  if (role==='screen'){
    try{
      document.addEventListener('contextmenu', (e)=>{
        const t = e.target;
        if (t && (t.tagName==='AUDIO' || t.tagName==='VIDEO')) e.preventDefault();
      }, { capture:true });
    }catch(e){}
  }

  // Audio hooks (Publikum) einmalig binden
  try{ bindAudienceAudioEventsOnce(); }catch(e){}

  // Avatar-Cache aus lokalem State initialisieren + (Host) remote bereitstellen
  try{
    __avatarCache = __avatarCache || {};
    (state.players||[]).forEach(p => { if (p.avatar) __avatarCache[p.id] = p.avatar; });
    if (role === 'host' && window.db) {
      (state.players||[]).forEach(p => { if (p.avatar) __saveAvatarRemote(p.id, p.avatar); });
    }
  }catch(e){}

  renderPlayersBar(role === 'screen');
  renderBoard();
  renderOverlay();
  if (role === 'editor') {
    if (els.editorNewBtn) els.editorNewBtn.onclick = () => editorNewBoard();
    if (els.editorLoadBtn) els.editorLoadBtn.onclick = () => editorLoadSelected();
    if (els.editorExportJson) els.editorExportJson.onclick = () => editorExport();
    if (els.editorSaveBtn) els.editorSaveBtn.onclick = () => editorSave(false);
    if (els.editorSaveAsBtn) els.editorSaveAsBtn.onclick = () => editorSave(true);
    if (els.editorRefreshBoards) els.editorRefreshBoards.onclick = async () => { await loadBoardsList(); renderEditor(); };
    if (els.editorBoardType) els.editorBoardType.onchange = () => renderEditor();
    if (els.editorBoards) els.editorBoards.onchange = () => editorLoadSelected();
    renderEditor();
  }
  attachGlobalHandlers();
  if (role === 'host') {
    sendSync();
  } else {
    setupRemoteListener();
  }
}

async function loadContent(urlOrFileText) {
  if (typeof urlOrFileText === 'string' && urlOrFileText.startsWith('local:')) {
    const name = urlOrFileText.slice(6);
    const txt = loadBoardFromLocal(name);
    if (!txt) throw new Error('Local board not found: ' + name);
    data = JSON.parse(txt);
    normalizeQuestions(data);
    state.settings = data.settings || {};
    return;
  }
  if (typeof urlOrFileText === 'string' && urlOrFileText.trim().startsWith('{')) {
    data = JSON.parse(urlOrFileText);
  } else if (typeof urlOrFileText === 'string') {
    const res = await fetch(urlOrFileText);
    data = await res.json();
  } else {
    data = urlOrFileText;
  }
  normalizeQuestions(data);
  state.settings = data.settings || {};
  state.players = (data.players || ['Spieler 1','Spieler 2']).map((name, i) => ({ id: `p${i+1}`, name, avatar: null, jokers:{j1:true,j2:true,j3:true} }));
  for (const p of state.players) if (!(p.id in state.scores)) state.scores[p.id] = 0;
}

async function loadBoardsList() {
  if (role !== 'host' && role !== 'editor') return;
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


    // Local boards (saved in browser)
    try{
      const locals = getLocalBoards();
      locals.forEach((lb) => {
        if (!lb || !lb.name) return;
        boards.unshift({ id: `local_${lb.name}`, label: `LOCAL • ${lb.name}`, url: `local:${lb.name}` });
      });
    }catch(e){} 

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
    avatar: p.avatar || null,
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
  if (role === 'editor') {
    if (els.editorNewBtn) els.editorNewBtn.onclick = () => editorNewBoard();
    if (els.editorLoadBtn) els.editorLoadBtn.onclick = () => editorLoadSelected();
    if (els.editorExportJson) els.editorExportJson.onclick = () => editorExport();
    if (els.editorSaveBtn) els.editorSaveBtn.onclick = () => editorSave(false);
    if (els.editorSaveAsBtn) els.editorSaveAsBtn.onclick = () => editorSave(true);
    if (els.editorRefreshBoards) els.editorRefreshBoards.onclick = async () => { await loadBoardsList(); renderEditor(); };
    if (els.editorBoardType) els.editorBoardType.onchange = () => renderEditor();
    if (els.editorBoards) els.editorBoards.onchange = () => editorLoadSelected();
    renderEditor();
  }
  sendSync();
}
window.SFX_BASE = (data && data.settings && data.settings.media_base) || 'media/';
if (!window.SFX_BASE.endsWith('/')) window.SFX_BASE += '/';

/* ======= Render ======= */

function __applyAvatarCache(){
  try{
    (state.players||[]).forEach(p => {
      if (__avatarCache && __avatarCache[p.id]) p.avatar = __avatarCache[p.id];
    });
  }catch(e){}
}

function __saveAvatarRemote(playerId, dataUrl){
  if (role !== 'host' || !window.db) return;
  try{
    const roomRef = window.db.collection('rooms').doc(remoteRoomId);
    // Avatare separat speichern (nicht im stateJson -> 1MB Firestore Limit)
    roomRef.collection('avatars').doc(playerId).set({
      avatar: dataUrl || null,
      updatedAt: Date.now()
    }, { merge: true });
  }catch(e){
    console.warn('Avatar remote save failed', e);
  }
}

function __setPlayerAvatar(playerId, dataUrl){
  const p = (state.players||[]).find(x => x.id === playerId);
  if (p) p.avatar = dataUrl || null;
  if (dataUrl) __avatarCache[playerId] = dataUrl;
  else delete __avatarCache[playerId];
  saveState();
  renderOverlay();
  if (role === 'editor') {
    if (els.editorNewBtn) els.editorNewBtn.onclick = () => editorNewBoard();
    if (els.editorLoadBtn) els.editorLoadBtn.onclick = () => editorLoadSelected();
    if (els.editorExportJson) els.editorExportJson.onclick = () => editorExport();
    if (els.editorSaveBtn) els.editorSaveBtn.onclick = () => editorSave(false);
    if (els.editorSaveAsBtn) els.editorSaveAsBtn.onclick = () => editorSave(true);
    if (els.editorRefreshBoards) els.editorRefreshBoards.onclick = async () => { await loadBoardsList(); renderEditor(); };
    if (els.editorBoardType) els.editorBoardType.onchange = () => renderEditor();
    if (els.editorBoards) els.editorBoards.onchange = () => editorLoadSelected();
    renderEditor();
  }
  if (els && els.playersBar) renderPlayersBar(role === 'screen');
  sendSync();
  __saveAvatarRemote(playerId, dataUrl);
}

// Bild-Datei -> kleines DataURL (verhindert Firestore 1MB-Limit & beschleunigt Sync)
function __fileToSmallDataUrl(file, maxSize=96, quality=0.82){
  return new Promise((resolve, reject) => {
    try{
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('img load failed'));
        img.onload = () => {
          const w = img.naturalWidth || img.width || 1;
          const h = img.naturalHeight || img.height || 1;
          const scale = Math.min(1, maxSize / Math.max(w, h));
          const cw = Math.max(1, Math.round(w * scale));
          const ch = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          // webp wenn verfügbar, sonst jpeg
          let out = '';
          try{ out = canvas.toDataURL('image/webp', quality); }catch(e){}
          if (!out || out.startsWith('data:,') || out.length < 50){
            try{ out = canvas.toDataURL('image/jpeg', quality); }catch(e){}
          }
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }catch(e){ reject(e); }
  });
}

function renderPlayersBar(readOnly=false) {
  els.playersBar.innerHTML = '';
  state.players.forEach((p, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'pill';

    const img = document.createElement('img'); img.className='avatar'; img.alt=''; img.src = p.avatar || ''; if (!p.avatar) img.style.opacity=.4;
    const file = document.createElement('input'); file.type='file'; file.accept='image/*'; file.className='file';
    file.onchange = async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      try{
        const small = await __fileToSmallDataUrl(f, 96, 0.82);
        __setPlayerAvatar(p.id, small);
        img.src = small;
        img.style.opacity = 1;
      }catch(err){
        console.warn('Avatar konnte nicht verarbeitet werden', err);
      }finally{
        file.value = ''; // Reset danach, damit man denselben Avatar nochmal wählen kann
      }
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
      el.title = i===0?'Schiebe-Joker':(i===1?'Risikojoker':'Telefonjoker');
      if (role==='host' && !readOnly){
        el.onclick = () => {
          const prev = !!p.jokers?.[key];
          p.jokers[key] = !prev;
          el.classList.toggle('off', !p.jokers[key]);
          saveState();
          renderOverlay();
  if (role === 'editor') {
    if (els.editorNewBtn) els.editorNewBtn.onclick = () => editorNewBoard();
    if (els.editorLoadBtn) els.editorLoadBtn.onclick = () => editorLoadSelected();
    if (els.editorExportJson) els.editorExportJson.onclick = () => editorExport();
    if (els.editorSaveBtn) els.editorSaveBtn.onclick = () => editorSave(false);
    if (els.editorSaveAsBtn) els.editorSaveAsBtn.onclick = () => editorSave(true);
    if (els.editorRefreshBoards) els.editorRefreshBoards.onclick = async () => { await loadBoardsList(); renderEditor(); };
    if (els.editorBoardType) els.editorBoardType.onchange = () => renderEditor();
    if (els.editorBoards) els.editorBoards.onchange = () => editorLoadSelected();
    renderEditor();
  }
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
  els.qText.textContent = (q.text || q.question || '');
  els.answer.textContent = (q.answer || q.solution || '—');
  // Host sieht Antwort sofort:
  els.answer.hidden = role !== 'host';
  setMedia(q);
  resetAnswerImages();
  try{ const vb = ensureAudienceVolumeUI(); if(vb){ vb.style.display = (q && q.audio) ? 'block' : 'none'; } }catch(e){}
  showAudioGateIfNeeded(q);
  try{ ensureEstimateUIForHost(id, q); }catch(e){}
  try{ showTimer((state.timer && state.timer.seconds) ? state.timer.seconds : 0); }catch(e){}


  const starterId = state.players[state.turn]?.id;
  const qst = state.q[id] ||= { status: 'open', attempts: [], starter: starterId };
  qst.status = 'open';

  // aktuell offene Frage im globalen State merken (für Publikum)
  state.current = { id, answerRevealed: false };
  state.audio = { playing:false, t:0, ts: Date.now() };
  saveState();
  sendSync();

  send('SHOW_Q', { id, q: { cat: cat.title, points: q.points, text: (q.text || q.question), answer: (q.answer || q.solution), image: q.image, image_reveal: q.image_reveal, audio: q.audio, video: q.video, answer_images: q.answer_images, answer_audio: q.answer_audio, answer_video: q.answer_video, ans1: q.ans1, ans2: q.ans2, type: q.type, estimate: q.estimate }});

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
    setAnswerMedia(current.q, base);
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
  // Wichtig: Remote-Publikum bekommt KEIN BroadcastChannel. Daher müssen play/pause/time auch in state.audio landen.
  if (els.qAud && !els.qAud.hidden) {
    // alte Handler entfernen (falls Modal mehrfach geöffnet wurde)
    try {
      if (els.qAud.__onTime)  els.qAud.removeEventListener('timeupdate', els.qAud.__onTime);
      if (els.qAud.__onPlay)  els.qAud.removeEventListener('play',      els.qAud.__onPlay);
      if (els.qAud.__onPause) els.qAud.removeEventListener('pause',     els.qAud.__onPause);
    } catch (e) {}

    // Timeupdate throttlen (sonst zu viele Writes)
    let __lastTimeSync = 0;

    const onTime = () => {
      const now = Date.now();
      if (now - __lastTimeSync < 800) return;
      __lastTimeSync = now;

      // lokal (gleiches Browser-Fenster)
      send('AUDIO_TIME', { t: els.qAud.currentTime });

      // remote (Firestore): nur Zeit, playing bleibt wie es ist
      if (role === 'host') {
        state.audio = {
          playing: !!(state.audio && state.audio.playing),
          t: els.qAud.currentTime || 0,
          // Wichtig: ts bei jedem Zeit-Sync aktualisieren, sonst extrapoliert der Screen doppelt.
          ts: Date.now()
        };
        saveState();
        sendSync();
      }
    };

    const onPlay = () => {
      // lokal
      send('AUDIO_META', { t: els.qAud.currentTime });
      send('AUDIO_PLAY');

      // remote
      if (role === 'host') {
        state.audio = { playing: true, t: els.qAud.currentTime || 0, ts: Date.now() };
        saveState();
        sendSync();
      }
    };

    const onPause = () => {
      // lokal
      send('AUDIO_PAUSE');

      // remote
      if (role === 'host') {
        state.audio = { playing: false, t: els.qAud.currentTime || 0, ts: Date.now() };
        saveState();
        sendSync();
      }
    };

    // speichern, damit wir beim nächsten Öffnen sauber entfernen können
    els.qAud.__onTime = onTime;
    els.qAud.__onPlay = onPlay;
    els.qAud.__onPause = onPause;

    els.qAud.addEventListener('timeupdate', onTime);
    els.qAud.addEventListener('play', onPlay);
    els.qAud.addEventListener('pause', onPause);
  }
  // Timer
  els.timerBtn.onclick = () => startTimer(10);

  els.modal.addEventListener('close', onModalCloseOnce, { once: true });
  if (role === 'host') { els.modal.classList.add('nonmodal'); els.modal.show(); } else { els.modal.classList.remove('nonmodal'); els.modal.showModal(); }
}

function onModalCloseOnce(){
  markBusyTile(false);
  stopTimer();

  // NEU: Antwortbilder zuverlässig zurücksetzen
  resetAnswerImages();
  try{
    const eb = document.getElementById('estimateBox');
    if (eb) eb.remove();
    const hb = document.getElementById('estimateHostBox');
    if (hb) hb.remove();
    if (__estimateUnsub) { __estimateUnsub(); __estimateUnsub = null; }
    __estimateData = {}; __estimateReveal = {};
    __estimateHostDocRef = null; __estimateHostQid = null;
  }catch(e){}
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

    // Zielzeit berechnen: t ist immer die zuletzt bekannte Zeit des Hosts.
    // Nur leicht extrapolieren, wenn ts aktuell ist (sonst entstehen riesige Sprünge).
    let target = Number(a.t || 0);
    const ts = Number(a.ts || 0);
    if (a.playing && ts > 0) {
      const dt = (Date.now() - ts) / 1000;
      if (dt >= 0 && dt <= 4.0) target += dt; // max 4s extrapolieren
    }

    if (!window.__audUnlocked) {
      // Ohne User-Interaktion dürfen Browser Audio oft nicht abspielen.
      try{ els.qAud.muted = true; }catch(e){}
      try{ els.qAud.pause(); }catch(e){}
      return;
    }

    try{ els.qAud.muted = false; }catch(e){}

    // Nicht bei jedem Sync hart seeken – nur wenn wir merklich daneben liegen.
    try{
      const cur = Number(els.qAud.currentTime || 0);
      if (Number.isFinite(target) && Math.abs(cur - target) > 0.35) {
        els.qAud.currentTime = target;
      }
    }catch(e){}

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
      // Timerbox nicht hart verstecken – wird über state.timer / TIMER Sync gesteuert
  // if (els.timerBox) els.timerBox.hidden = true;
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
            ans2: q.ans2,
            type: q.type,
            estimate: q.estimate
          }
        };
        break;
      }
    }
    if (found) break;
  }
  if (!found) return;

  // Frage beim Publikum anzeigen (aber nicht bei jedem Sync neu rendern, sonst lädt Audio ständig neu)
  if (!els.modal.open || __screenShownId !== found.id) {
    showForAudience(found);
  } else {
    // nur sicherstellen, dass Audio/Timer/Answer-Status aktualisiert wird
    syncAudienceAudioFromState();
  }

  // Falls Antwort bereits aufgedeckt wurde, auch beim Publikum anzeigen
  if (cur.answerRevealed) {
    try {
      const base = (data.settings && data.settings.media_base) || 'media/';
      showAnswerImages(found.q || {}, base);
    } catch (e) {}
    els.answer.hidden = false;
  }
}

function setupRemoteListener() {
  if (role !== 'screen') return;
  if (!window.db) return;
  try {
    const roomRef = window.db.collection('rooms').doc(remoteRoomId);

    // Avatare separat laden (sonst würde stateJson > 1MB werden)
    if (!__avatarUnsub) {
      __avatarUnsub = roomRef.collection('avatars').onSnapshot((snap) => {
        try{
          snap.docChanges().forEach(ch => {
            const pid = ch.doc.id;
            const d = ch.doc.data() || {};
            if (typeof d.avatar === 'string' && d.avatar.startsWith('data:')) {
              __avatarCache[pid] = d.avatar;
            } else if (d.avatar === null) {
              delete __avatarCache[pid];
            }
          });
          __applyAvatarCache();
          // nur wenn wir schon Spieler haben, sonst später beim SYNC_STATE
          if (role === 'screen') { renderPlayersBar(true); renderOverlay(); }
        }catch(e){}
      });
    }
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
              try{ normalizeQuestions(dataRemote); }catch(e){}
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
  __screenShownId = id;

  els.qCat.textContent = q.cat;
  els.qPts.innerHTML = `<span class="pos">+${q.points}</span> <span class="neg">-${Math.floor(q.points/2)}</span>`;
  els.qText.textContent = (q.text || q.question || '');
  els.answer.textContent = (q.answer || q.solution || '—');
  els.answer.hidden = true;
  setMedia(q);
  resetAnswerImages();
  try{ const vb = ensureAudienceVolumeUI(); if(vb){ vb.style.display = (q && q.audio) ? 'block' : 'none'; } }catch(e){}
  showAudioGateIfNeeded(q);
  try{ ensureEstimateUIForScreen(id, q); }catch(e){}
  try{ showTimer((state.timer && state.timer.seconds) ? state.timer.seconds : 0); }catch(e){}
  // Timerbox nicht hart verstecken – wird über state.timer / TIMER Sync gesteuert
  // if (els.timerBox) els.timerBox.hidden = true;
  syncAudienceAudioFromState();
  els.modal.showModal();
}

/* ======= Timer ======= */
function startTimer(seconds){
  stopTimer();
  let t = seconds;
  els.timerBox.hidden = false;
  els.timerBox.textContent = t;
  send('TIMER', { seconds: t });
  if (role==='host'){ state.timer = { seconds: t, ts: Date.now() }; saveState(); sendSync(); }
  timerInt = setInterval(() => {
    t--; els.timerBox.textContent = t; send('TIMER', { seconds: t });
    if (role==='host'){ state.timer = { seconds: t, ts: Date.now() }; saveState(); sendSync(); }
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
  if (role==='host'){ state.timer = { seconds: 0, ts: Date.now() }; saveState(); sendSync(); }
}

/* ======= Gemeinsames ======= */
function playSfx(kind, opts) {
  if (role==='screen' && !window.__audUnlocked && !(opts && opts.prime)) return;
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
        try { tag.load(); } catch(e) {}
        tag.muted = false;
        return;
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
      try { a.load(); } catch(e) {}
      a.muted = false;
      return;
    } else {
      a.muted = false;
      a.play().catch(() => {});
    }
  } catch (e) {}
}


function resetAnswerImages(){
  resetAnswerMedia();
  if (!els.answerImages) return;
  els.answerImages.hidden = true;
  els.answerImages.classList.remove('single');
  if (els.ansImg1) { els.ansImg1.src = ''; els.ansImg1.hidden = true; }
  if (els.ansImg2) { els.ansImg2.src = ''; els.ansImg2.hidden = true; }
}


function resetAnswerMedia(){
  if (els.ansAud){ try{ els.ansAud.pause(); }catch(e){} els.ansAud.removeAttribute('src'); els.ansAud.hidden = true; }
  if (els.ansVid){ try{ els.ansVid.pause(); }catch(e){} els.ansVid.removeAttribute('src'); els.ansVid.hidden = true; }
}
function setAnswerMedia(q, base){
  resetAnswerMedia();
  if (!q) return;
  base = base || (data.settings && data.settings.media_base) || 'media/';
  if (q.answer_audio && els.ansAud){
    els.ansAud.src = base + q.answer_audio;
    els.ansAud.hidden = false;
  }
  if (q.answer_video && els.ansVid){
    els.ansVid.src = base + q.answer_video;
    els.ansVid.hidden = false;
  }
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
function showAnswerMediaForCurrent(){
  try{
    const base = (data.settings && data.settings.media_base) || 'media/';
    if (current && current.q) setAnswerMedia(current.q, base);
  }catch(e){}
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
  if (role === 'editor') {
    if (els.editorNewBtn) els.editorNewBtn.onclick = () => editorNewBoard();
    if (els.editorLoadBtn) els.editorLoadBtn.onclick = () => editorLoadSelected();
    if (els.editorExportJson) els.editorExportJson.onclick = () => editorExport();
    if (els.editorSaveBtn) els.editorSaveBtn.onclick = () => editorSave(false);
    if (els.editorSaveAsBtn) els.editorSaveAsBtn.onclick = () => editorSave(true);
    if (els.editorRefreshBoards) els.editorRefreshBoards.onclick = async () => { await loadBoardsList(); renderEditor(); };
    if (els.editorBoardType) els.editorBoardType.onchange = () => renderEditor();
    if (els.editorBoards) els.editorBoards.onchange = () => editorLoadSelected();
    renderEditor();
  }
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
    audio: state.audio,
    fxPulse: state.fxPulse || null,
    timer: state.timer || { seconds:0, ts:0 }
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
    state.timer = s.timer || state.timer || { seconds:0, ts:0 };
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


/* ======= Schätzfrage (Estimate) =======
JSON: in der Frage z.B.  "type":"estimate"  oder  "estimate":true
Publikum kann eine Zahl eingeben, Host sieht alle Eingaben und kann sie nacheinander aufdecken.
*/
function isEstimateQuestion(q){
  return !!(q && (q.type === 'estimate' || q.estimate === true || q.mode === 'estimate'));
}
function getClientId(){
  let id = localStorage.getItem('aud_client_id');
  if (!id){
    id = 'c_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(2,6);
    localStorage.setItem('aud_client_id', id);
  }
  return id;
}
function getClientName(){
  return localStorage.getItem('aud_client_name') || '';
}

let __estimateUnsub = null;
let __estimateData = {};
let __estimateReveal = {};
let __estimateHostDocRef = null;
let __estimateHostQid = null;

function ensureEstimateUIForScreen(qid, q){
  if (role !== 'screen') return;

  // HART: wenn keine Schätzfrage → UI sicher entfernen
  if (!isEstimateQuestion(q)) {
    try{
      const eb = document.getElementById('estimateBox');
      if (eb) eb.remove();
      const hb = document.getElementById('estimateHostBox');
      if (hb) hb.remove();
      if (__estimateUnsub) { __estimateUnsub(); __estimateUnsub = null; }
      __estimateData = {}; __estimateReveal = {};
      __estimateHostDocRef = null; __estimateHostQid = null;
    }catch(e){}
    return;
  }

  let box = document.getElementById('estimateBox');
  const isNewQ = !box || box.dataset.qid !== String(qid);

  if (!box){
    box = document.createElement('div');
    box.id = 'estimateBox';
    box.style.margin = '14px auto 0';
    box.style.maxWidth = '560px';
    box.style.width = '92%';
    box.style.background = 'rgba(18,18,31,.75)';
    box.style.border = '1px solid rgba(255,255,255,.12)';
    box.style.borderRadius = '14px';
    box.style.padding = '12px 14px';
    box.style.textAlign = 'center';

    const t = document.createElement('div');
    t.textContent = 'Schätzung abgeben';
    t.style.fontWeight = '900';
    t.style.letterSpacing = '.04em';
    t.style.marginBottom = '8px';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.justifyContent = 'center';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';

    const name = document.createElement('input');
    name.id = 'estimateName';
    name.type = 'text';
    name.placeholder = 'Name';
    name.style.width = '180px';
    name.style.padding = '10px 12px';
    name.style.borderRadius = '10px';
    name.style.border = '1px solid rgba(255,255,255,.18)';
    name.style.background = 'rgba(23,23,42,.8)';
    name.style.color = 'white';
    name.style.fontSize = '16px';
    name.autocomplete = 'off';
    name.value = localStorage.getItem('aud_client_name') || '';
    name.addEventListener('input', ()=> localStorage.setItem('aud_client_name', name.value.trim()));

    const inp = document.createElement('input');
    inp.id = 'estimateInput';
    inp.type = 'number';
    inp.inputMode = 'numeric';
    inp.placeholder = 'Schätzung';
    inp.style.width = '180px';
    inp.style.padding = '10px 12px';
    inp.style.borderRadius = '10px';
    inp.style.border = '1px solid rgba(255,255,255,.18)';
    inp.style.background = 'rgba(23,23,42,.8)';
    inp.style.color = 'white';
    inp.style.fontSize = '18px';
    inp.autocomplete = 'off';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Abgeben';
    btn.style.padding = '10px 14px';
    btn.style.borderRadius = '10px';
    btn.style.border = '1px solid rgba(255,255,255,.16)';
    btn.style.background = 'rgba(155,107,255,.25)';
    btn.style.color = 'white';
    btn.style.fontWeight = '800';
    btn.style.cursor = 'pointer';

    const msg = document.createElement('div');
    msg.id = 'estimateMsg';
    msg.style.marginTop = '8px';
    msg.style.opacity = '.9';
    msg.style.fontSize = '13px';

    const submit = async () => {
      const v = Number(inp.value);
      const nm = (name.value || '').trim();
      if (!Number.isFinite(v)) return;
      if (!nm) { msg.textContent = 'Bitte Name eingeben'; return; }
      if (!window.db) { msg.textContent = '⚠️ Keine Verbindung'; return; }
      const cid = getClientId();
      try{
        const roomRef = window.db.collection('rooms').doc(remoteRoomId);
        const curQid = String((document.getElementById('estimateBox')?.dataset.qid) || qid);
        const docRef = roomRef.collection('estimates').doc(curQid);
        const payload = {};
        payload[cid] = { name: nm, value: v, ts: Date.now() };
        await docRef.set(payload, { merge: true });
        msg.textContent = '✅ Abgegeben';
      }catch(e){
        msg.textContent = '⚠️ Konnte nicht senden';
      }
    };

    btn.addEventListener('click', submit);
    inp.addEventListener('keydown', (e)=>{ if (e.key==='Enter') { e.preventDefault(); submit(); } });

    const listTitle = document.createElement('div');
    listTitle.textContent = 'Schätzungen';
    listTitle.style.marginTop = '10px';
    listTitle.style.fontWeight = '800';
    listTitle.style.opacity = '.95';

    const list = document.createElement('div');
    list.id = 'estimateList';
    list.style.marginTop = '6px';
    list.style.textAlign = 'left';
    list.style.maxHeight = '170px';
    list.style.overflowY = 'auto';
    list.style.paddingRight = '6px';

    row.append(name, inp, btn);
    box.append(t, row, msg, listTitle, list);

    const modalForm = document.querySelector('#qModal .modal');
    if (modalForm) modalForm.appendChild(box);
  }

  // pro neue Schätzfrage Status resetten
  box.dataset.qid = String(qid);
  if (isNewQ){
    try{
      const msg = document.getElementById('estimateMsg');
      if (msg) msg.textContent = '';
      const inp = document.getElementById('estimateInput');
      if (inp) inp.value = '';
    }catch(e){}
    // Reveal-Cache nur für diese Runde neu
    __estimateReveal = {};
  }

  if (window.db){
    try{
      const roomRef = window.db.collection('rooms').doc(remoteRoomId);
      const docRef = roomRef.collection('estimates').doc(String(qid));
      __estimateHostDocRef = docRef;
      __estimateHostQid = String(qid);
      if (__estimateUnsub) __estimateUnsub();
      __estimateUnsub = docRef.onSnapshot((d)=>{
        __estimateData = d.exists ? (d.data() || {}) : {};
        try{
          const cid = getClientId();
          const msg = document.getElementById('estimateMsg');
          if (msg) msg.textContent = __estimateData[cid] ? '✅ Abgegeben' : '';
        }catch(e){}

        // Liste rendern (Name + zensierte/aufgedeckte Antwort)
        try{
          const list = document.getElementById('estimateList');
          if (!list) return;
          list.innerHTML = '';
          const reveal = (__estimateData && __estimateData.__reveal) ? (__estimateData.__reveal || {}) : {};
          const winner = (__estimateData && __estimateData.__winner) ? String(__estimateData.__winner) : null;

          const entries = Object.entries(__estimateData || {})
            .filter(([k,v])=> k && !String(k).startsWith('__') && v && typeof v === 'object')
            .sort((a,b)=> (a[1].ts||0) - (b[1].ts||0));

          if (!entries.length){
            const p = document.createElement('div');
            p.textContent = 'Noch keine Schätzungen...';
            p.style.opacity = '.8';
            p.style.fontSize = '13px';
            list.appendChild(p);
            return;
          }

          entries.forEach(([cid,v])=>{
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '6px 8px';
            row.style.border = '1px solid rgba(255,255,255,.10)';
            row.style.borderRadius = '10px';
            row.style.background = 'rgba(10,10,18,.35)';
            row.style.marginBottom = '6px';

            if (winner && String(cid) === winner){
              row.style.borderColor = 'rgba(155,107,255,.65)';
              row.style.boxShadow = '0 0 0 2px rgba(155,107,255,.20) inset';
            }

            const left = document.createElement('div');
            left.textContent = (v.name || 'Unbekannt');
            left.style.fontWeight = '800';

            const right = document.createElement('div');
            const isRev = !!reveal[String(cid)];
            right.textContent = isRev ? String(v.value) : '…';
            right.style.opacity = isRev ? '1' : '.7';
            right.style.fontWeight = '900';

            row.append(left, right);
            list.appendChild(row);
          });
        }catch(e){}
      });
    }catch(e){}
  }
}

function ensureEstimateUIForHost(qid, q){
  if (role !== 'host' && role !== 'editor') return;

  // Wenn keine Schätzfrage: Host-UI entfernen und Listener stoppen (Firestore unangetastet lassen)
  if (!isEstimateQuestion(q)) {
    try{
      const hb = document.getElementById('estimateHostBox');
      if (hb) hb.remove();
      if (__estimateUnsub) { __estimateUnsub(); __estimateUnsub = null; }
      __estimateData = {}; __estimateReveal = {};
      __estimateHostDocRef = null; __estimateHostQid = null;
    }catch(e){}
    return;
  }

  if (!window.db) return;

  const qidStr = String(qid);

  // Bei neuer Schätzfrage: auf neue Doc-Ref wechseln und die Runde im Firestore leeren
  if (__estimateHostQid !== qidStr) {
    try{
      if (__estimateUnsub) { __estimateUnsub(); __estimateUnsub = null; }
    }catch(e){}
    __estimateData = {};
    __estimateReveal = {};
    __estimateHostQid = qidStr;

    try{
      const roomRef = window.db.collection('rooms').doc(remoteRoomId);
      const docRef = roomRef.collection('estimates').doc(qidStr);
      __estimateHostDocRef = docRef;

      // WICHTIG: alte Einträge vollständig entfernen (sonst bleiben Schätzungen aus früheren Fragen sichtbar)
      docRef.set({
        __resetTs: Date.now(),
        __reveal: {},
        __revealTs: Date.now(),
        __winner: null,
        __winnerTs: Date.now()
      }, { merge: false });
    }catch(e){
      console.warn('Estimate reset failed', e);
    }
  }

  let box = document.getElementById('estimateHostBox');
  if (!box){
    box = document.createElement('div');
    box.id = 'estimateHostBox';
    box.style.marginTop = '10px';
    box.style.paddingTop = '10px';
    box.style.borderTop = '1px solid rgba(255,255,255,.12)';

    const title = document.createElement('div');
    title.textContent = 'Schätzungen';
    title.style.fontWeight = '900';
    title.style.opacity = '.95';
    title.style.letterSpacing = '.04em';
    title.style.marginBottom = '8px';

    const list = document.createElement('div');
    list.id = 'estimateHostList';
    list.style.display = 'grid';
    list.style.gap = '8px';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '10px';
    actions.style.flexWrap = 'wrap';
    actions.style.marginTop = '8px';

    const btnRevealAll = document.createElement('button');
    btnRevealAll.type = 'button';
    btnRevealAll.textContent = 'Alle aufdecken';
    btnRevealAll.onclick = ()=>{ try{ Object.keys(__estimateData||{}).forEach(k=>{ if(!String(k).startsWith('__')) __estimateReveal[String(k)] = true; }); }catch(e){} try{ persistEstimateMeta(); }catch(e){} try{ renderEstimateHostList(q); }catch(e){} };

    const btnWinner = document.createElement('button');
    btnWinner.type = 'button';
    btnWinner.textContent = 'Nächster dran markieren';
    btnWinner.onclick = ()=>{ try{ markClosestEstimate(q); }catch(e){} };

    actions.append(btnRevealAll, btnWinner);

    box.append(title, list, actions);

    const modalForm = document.querySelector('#qModal .modal');
    if (modalForm) modalForm.appendChild(box);
  }

  // Live-Liste abonnieren
  try{
    if (!__estimateHostDocRef){
      const roomRef = window.db.collection('rooms').doc(remoteRoomId);
      __estimateHostDocRef = roomRef.collection('estimates').doc(qidStr);
    }
    if (__estimateUnsub) { /* already subscribed */ }
    if (!__estimateUnsub){
      __estimateUnsub = __estimateHostDocRef.onSnapshot((d)=>{
        __estimateData = d.exists ? (d.data() || {}) : {};
        renderEstimateHostList(q);
      });
    } else {
      // Falls Listener schon läuft, trotzdem einmal rendern (z.B. nach UI-Neuaufbau)
      renderEstimateHostList(q);
    }
  }catch(e){
    console.warn('Estimate host subscribe failed', e);
  }
}

function renderEstimateHostList(q){
  const list = document.getElementById('estimateHostList');
  if (!list) return;
  list.innerHTML = '';

  const entries = Object.entries(__estimateData||{})
    .map(([cid,v])=>({ cid, ...(v||{}) }))
    .filter(x=>x && typeof x.value !== 'undefined')
    .sort((a,b)=>(a.ts||0)-(b.ts||0));

  entries.forEach(ent=>{
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.padding = '8px 10px';
    row.style.borderRadius = '12px';
    row.style.border = '1px solid rgba(255,255,255,.12)';
    row.style.background = 'rgba(18,18,31,.55)';

    const left = document.createElement('div');
    left.style.fontWeight = '800';
    left.textContent = ent.name || ent.cid;

    const val = document.createElement('div');
    val.style.fontVariantNumeric = 'tabular-nums';
    const revealed = !!__estimateReveal[ent.cid];
    val.textContent = revealed ? String(ent.value) : '•••';
    val.style.opacity = revealed ? '1' : '.7';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = revealed ? 'Verbergen' : 'Aufdecken';
    btn.style.padding = '6px 10px';
    btn.style.borderRadius = '10px';
    btn.style.border = '1px solid rgba(255,255,255,.16)';
    btn.style.background = 'rgba(155,107,255,.14)';
    btn.style.color = 'white';
    btn.style.fontWeight = '800';
    btn.style.cursor = 'pointer';
    btn.onclick = () => {
      __estimateReveal[ent.cid] = !revealed;
      try { persistEstimateMeta(); } catch(e){}
      renderEstimateHostList(q);
    };

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '🗑';
    delBtn.title = 'Entfernen';
    delBtn.style.padding = '6px 10px';
    delBtn.style.borderRadius = '10px';
    delBtn.style.border = '1px solid rgba(255,255,255,.16)';
    delBtn.style.background = 'rgba(255,92,116,.12)';
    delBtn.style.color = 'white';
    delBtn.style.fontWeight = '800';
    delBtn.style.cursor = 'pointer';
    delBtn.onclick = ()=>{ deleteEstimateEntry(ent.cid); };

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '8px';
    right.style.alignItems = 'center';
    right.append(btn, delBtn);

    row.append(left, val, right);
    list.appendChild(row);
  });

  if (!entries.length){
    const empty = document.createElement('div');
    empty.style.opacity = '.75';
    empty.textContent = 'Noch keine Eingaben…';
    list.appendChild(empty);
  }
}

function markClosestEstimate(q){
  let ans = (q && q.answer) ? String(q.answer) : '';
  const m = ans.match(/-?\d+(?:[\.,]\d+)?/);
  if (!m) return;
  const correct = Number(m[0].replace(',','.'));
  if (!Number.isFinite(correct)) return;

  let best = null;

  Object.entries(__estimateData||{}).forEach(([cid,v])=>{
    const val = Number(v && v.value);
    if (!Number.isFinite(val)) return;
    const diff = Math.abs(val - correct);
    if (!best || diff < best.diff) best = { cid, diff };
  });
  if (!best) return;

  __estimateReveal[best.cid] = true;
  try{ persistEstimateMeta(); }catch(e){}
  renderEstimateHostList(q);

  // Gewinner auch im Publikum highlighten (via Firestore in estimates doc: __winner)
  try{
    if (role==='host' && __estimateHostDocRef) {
      __estimateHostDocRef.set({ __winner: best.cid, __winnerTs: Date.now() }, { merge:true });
    }
  }catch(e){}
}

function deleteEstimateEntry(clientId){
  if (role !== 'host' && role !== 'editor') return;
  try{
    if (!window.db || !__estimateHostDocRef) return;
    const del = firebase.firestore.FieldValue.delete();
    __estimateHostDocRef.update({ [String(clientId)]: del });

    // Falls der gelöschte gerade Winner war, Winner entfernen
    try{
      if (__estimateData && __estimateData.__winner === String(clientId)) {
        __estimateHostDocRef.update({ __winner: del, __winnerTs: Date.now() });
      }
    }catch(e){}

    // Lokale Caches bereinigen (UI reagiert auch über onSnapshot)
    try{ delete __estimateData[String(clientId)]; }catch(e){}
    try{ delete __estimateReveal[String(clientId)]; }catch(e){}
  }catch(e){
    console.warn('Estimate delete failed', e);
  }
}


function persistEstimateMeta(){
  try{
    if (role !== 'host' && role !== 'editor') return;
    if (!__estimateHostDocRef) return;
    __estimateHostDocRef.set({
      __reveal: __estimateReveal || {},
      __revealTs: Date.now(),
      __winner: (__estimateData && __estimateData.__winner) ? __estimateData.__winner : null
    }, { merge:true });
  }catch(e){}
}


/* ======= Helper & Global ======= */
function idToName(pid){ return state.players.find(p => p.id === pid)?.name || pid; }
function sendSync() {
  // KEINE DOM-Elemente mitschicken (z. B. _scoreEl entfernen)
  const playersLocal = state.players.map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar || null,
    jokers: p.jokers || {}
  }));

  const stateForWireLocal = {
    players: playersLocal,
    scores: state.scores,
    q: {},
    used: Array.from(state.used),
    settings: state.settings,
    turn: state.turn,
    current: state.current,
    audio: state.audio,
    fxPulse: state.fxPulse || null,
    timer: state.timer || { seconds:0, ts:0 }
  };

  // lokal an andere Tabs (selber Browser)
  send('SYNC_STATE', { state: stateForWireLocal, data });

  // remote an Firestore: OHNE Avatare (1MB-Limit)
  if (role === 'host' && window.db) {
    try {
      const roomRef = window.db.collection('rooms').doc(remoteRoomId);

      const playersRemote = state.players.map(p => ({
        id: p.id,
        name: p.name,
        jokers: p.jokers || {}
      }));

      const stateForWireRemote = {
        players: playersRemote,
        scores: state.scores,
        q: {},
        used: Array.from(state.used),
        settings: state.settings,
        turn: state.turn,
        current: state.current,
        audio: state.audio,
        fxPulse: state.fxPulse || null,
        timer: state.timer || { seconds:0, ts:0 }
      };

      const docData = {
        stateJson: JSON.stringify(stateForWireRemote),
        boardUrl: localStorage.getItem("quiz_board_file"),
        updatedAt: Date.now()
      };
      roomRef.set(docData, { merge: true });
    } catch (e) {
      console.warn('Remote-Sync fehlgeschlagen', e);
    }
  }
}
function sendScores(){ send('SCORES', { scores: state.scores }); }
function sendTurn(){ send('TURN', { turn: state.turn }); }
function fxLocal(type){
  if(!els.fx) return;
  els.fx.style.background = type==='correct' ? 'rgba(63,191,108,.25)' : 'rgba(255,92,116,.25)';
  els.fx.classList.remove('show'); void els.fx.offsetWidth; els.fx.classList.add('show');
  playSfx(type);
}

function fx(type){
  if(role==='host'){
    state.fxPulse = { type, ts: Date.now() };
    saveState();
    sendSync();
    // zusätzlich lokal an andere Tabs (gleicher Browser) schicken
    send('FX', { type, ts: state.fxPulse.ts });
  }
  fxLocal(type);
}

function attachGlobalHandlers() {
  if (els.editorBtn && role === 'host') {
    els.editorBtn.onclick = () => window.open(`${location.pathname}?view=editor&key=${HOST_SECRET}`, 'quiz-editor');
  }
  if (els.refreshBoardsBtn && role === 'host') {
    els.refreshBoardsBtn.onclick = async () => { await loadBoardsList(); };
  }

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
    if (role !== 'host' && role !== 'editor') return;
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
