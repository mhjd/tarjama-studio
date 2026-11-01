'use strict';
let data = null, busy = false, comparison = [], view = 'audition', drag = null;
let benchmarkData = {voices:[]}, compareMode = 'clone', benchmarkRefreshBusy = false;
const $ = id => document.getElementById(id);
const stopAudio = () => document.querySelectorAll('audio,video').forEach(audio => audio.pause());
const selected = () => data.voices.filter(v => v.decision === 'keep').sort((a,b) => (a.favorite_rank ?? Infinity)-(b.favorite_rank ?? Infinity) || a.path.localeCompare(b.path));
const drafts = new Map();
let writes = Promise.resolve();
const current = () => data?.voices.find(v => v.decision === null);
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
function saved(message = 'Enregistré dans SQLite') { $('save-status').textContent = message; $('save-status').className = 'saved'; }
async function load() {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('Impossible de lire la base locale. Vérifie que le serveur est lancé.');
  data = await response.json();
  render(); saved();
}
function write(action, extra = {}) {
  const pending = writes.then(() => performWrite(action,extra));
  writes = pending.catch(() => {});
  return pending;
}
async function performWrite(action, extra) {
  if (!data) return;
  // A note blur must not disable the ranking button the user is clicking.
  // The shared queue still commits that note before the subsequent action.
  busy = action !== 'note'; showError(''); setDisabled(); $('save-status').className = ''; $('save-status').textContent = 'Enregistrement…';
  try {
    const voice = data.voices.find(v => v.path === extra.path);
    const response = await fetch('/api/' + action, {method:'POST', headers:{'Content-Type':'application/json', 'X-Voice-Audition':'1'}, body:JSON.stringify({revision:data.revision, order_revision:data.order_revision, note_revision:voice?.note_revision, ...extra})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Modification non enregistrée.');
    data = result;
    if (action === 'note') {
      const key = extra.path + ':' + extra.kind;
      if (drafts.get(key) === extra.note) drafts.delete(key);
    } else { stopAudio(); render(); }
    saved(drafts.size ? 'Notes non enregistrées' : 'Enregistré dans SQLite');
  } catch (error) { showError(error.message + ' Modification non confirmée.'); $('save-status').className = ''; $('save-status').textContent = 'À vérifier'; }
  finally { busy = false; setDisabled(); }
}
function noteFor(voice,kind) {
  const box = document.createElement('label'); box.className = 'voice-note';
  box.append(label('span',kind === 'reference' ? 'Note sur la référence' : 'Note sur le doublage'));
  const text = document.createElement('textarea'), key = voice.path + ':' + kind;
  text.rows = 3; text.maxLength = 2000; text.placeholder = 'Ton avis… (enregistré en quittant le champ)';
  text.value = drafts.get(key) ?? voice[kind + '_note'];
  text.oninput = () => { drafts.set(key,text.value); $('save-status').textContent = 'Note à enregistrer'; $('save-status').className = ''; };
  text.onblur = () => { if (drafts.has(key)) write('note',{path:voice.path,kind,note:text.value}).catch(() => {}); };
  box.append(text); return box;
}
window.addEventListener('beforeunload',event => { if (drafts.size || busy) { event.preventDefault(); event.returnValue = ''; } });
function setDisabled() {
  $('keep').disabled = $('pass').disabled = busy || !current();
  $('undo').disabled = busy || !data?.can_undo;
  document.querySelectorAll('[data-write]').forEach(b => b.disabled = busy || b.dataset.boundary === '1');
}
function switchView(next) {
  stopAudio(); view = next; $('audition').hidden = next !== 'audition'; $('favorites').hidden = next !== 'favorites';
  $('tab-audition').classList.toggle('active', next === 'audition'); $('tab-favorites').classList.toggle('active', next === 'favorites');
  $('tab-audition').setAttribute('aria-pressed', String(next === 'audition')); $('tab-favorites').setAttribute('aria-pressed', String(next === 'favorites'));
  location.hash = next;
}
function audioFor(voice) {
  const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = voice.url;
  audio.setAttribute('aria-label', `Écouter la voix ${voice.speaker}`); return audio;
}
function cloneSlot(voice) {
  const slot = document.createElement('div'); slot.dataset.benchmarkPath = voice.path; slot.className = 'clone-slot'; return slot;
}
function updateClones() {
  const jobs = new Map(benchmarkData.voices.map(row => [row.voice_path,row]));
  if (benchmarkData.label) $('benchmark-label').textContent = benchmarkData.label;
  const kept = data ? selected() : [];
  $('benchmark-progress').textContent = `${kept.filter(v => jobs.get(v.path)?.video_url).length} / ${kept.length} vidéos doublées prêtes`;
  document.querySelectorAll('[data-benchmark-path]').forEach(slot => {
    const job = jobs.get(slot.dataset.benchmarkPath), signature = JSON.stringify(job || null);
    if (slot.dataset.signature === signature) return;
    // Never replace a playing player just to update a progress counter.
    if (job?.video_url && slot.dataset.url === job.video_url && slot.querySelector('video')) return;
    slot.dataset.signature = signature; slot.replaceChildren();
    if (job?.video_url) {
      slot.append(label('p','Vidéo doublée · sous-titres alignés · voix à vitesse naturelle','audio-title'));
      const video = document.createElement('video'); video.controls = true; video.preload = 'none'; video.playsInline = true; video.src = job.video_url;
      video.setAttribute('aria-label','Voir la conférence avec cette voix clonée'); slot.append(video); slot.dataset.url = job.video_url;
    } else {
      const message = job?.video_status === 'error' ? `Rendu interrompu : ${job.video_error}` : job?.video_status === 'running' ? 'Rendu de la vidéo et alignement des sous-titres…' : 'Vidéo en attente de rendu (audio cloné conservé).';
      slot.append(label('p',message,'clone-status'));
    }
  });
}
async function refreshBenchmarks() {
  if (benchmarkRefreshBusy) return;
  benchmarkRefreshBusy = true;
  try {
    const response = await fetch('/api/benchmarks');
    if (!response.ok) throw new Error();
    benchmarkData = await response.json(); updateClones();
  } catch { $('benchmark-progress').textContent = 'Suivi des essais indisponible — nouvelle tentative automatique.'; }
  finally { benchmarkRefreshBusy = false; }
}
function label(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function button(text, fn, className = 'outline') { const node = label('button', text, className); node.onclick = fn; return node; }
function render() {
  const voice = current(), favorites = selected(), reviewed = data.voices.filter(v => v.decision !== null).length;
  $('favorite-count').textContent = favorites.length;
  $('progress-label').textContent = `${reviewed} / ${data.voices.length} voix explorées`;
  $('remaining').textContent = `${data.voices.length - reviewed} à découvrir`;
  $('progress').max = Math.max(1,data.voices.length); $('progress').value = reviewed;
  $('database-path').textContent = data.database; $('voice-card').hidden = !voice; $('finished').hidden = !!voice;
  const audio = $('main-audio');
  if (voice) {
    $('voice-name').textContent = `Voix ${voice.speaker}`; $('voice-file').textContent = voice.name;
    if (audio.dataset.path !== voice.path) { audio.pause(); audio.src = voice.url; audio.dataset.path = voice.path; audio.load(); }
    $('source-link').href = voice.url.replace('/resolve/', '/blob/');
  }
  comparison = comparison.filter(p => favorites.some(v => v.path === p));
  const grid = $('favorite-grid'); grid.replaceChildren(); $('no-favorites').hidden = favorites.length > 0;
  $('selection-help').hidden = !favorites.length; $('export').disabled = !favorites.length;
  favorites.forEach((voice,index) => {
    const card = document.createElement('article'); card.className = 'favorite-card';
    card.append(label('h2', `${index+1}. Voix ${voice.speaker}`), label('p', voice.name));
    const media = document.createElement('div'); media.className = 'voice-media';
    const reference = document.createElement('div');
    reference.append(label('p','Référence originale · enhanced','audio-title'),audioFor(voice),noteFor(voice,'reference'));
    const clone = document.createElement('div'); clone.append(cloneSlot(voice),noteFor(voice,'clone'));
    media.append(reference,clone); card.append(media);
    const actions = document.createElement('div'); actions.className = 'favorite-actions';
    const chosen = comparison.includes(voice.path);
    const compareButton = button(chosen ? '✓ À comparer' : 'Comparer', () => {
      if (comparison.includes(voice.path)) comparison = comparison.filter(p => p !== voice.path);
      else if (comparison.length < 2) comparison.push(voice.path);
      else { showError('Deux voix sont déjà dans le face-à-face. Retire-en une pour en choisir une autre.'); return; }
      showError(''); stopAudio(); render();
    }, 'outline' + (chosen ? ' chosen' : ''));
    compareButton.setAttribute('aria-pressed', String(chosen));
    const remove = button('Retirer', () => write('decision', {path:voice.path, decision:'pass'})); remove.dataset.write = '1';
    const move = (offset) => { const paths = selected().map(v => v.path); [paths[index],paths[index+offset]] = [paths[index+offset],paths[index]]; write('order',{paths}).catch(() => {}); };
    const up = button('↑ Monter',() => move(-1)), down = button('↓ Descendre',() => move(1));
    up.dataset.write = down.dataset.write = '1'; up.dataset.boundary = index === 0 ? '1' : '0'; down.dataset.boundary = index === favorites.length-1 ? '1' : '0';
    actions.append(up,down,compareButton, remove); card.append(actions); grid.append(card);
  });
  $('comparison').hidden = comparison.length === 0;
  const slots = $('comparison-slots'); slots.replaceChildren();
  comparison.forEach((path,index) => { const voice = favorites.find(v => v.path === path), slot = document.createElement('div'); slot.append(label('h3', `${index ? 'B' : 'A'} · Voix ${voice.speaker}`), compareMode === 'clone' ? cloneSlot(voice) : audioFor(voice)); slots.append(slot); });
  if (comparison.length === 1) slots.append(label('p', 'Choisis une seconde voix dans ta sélection.'));
  setDisabled();
  updateClones();
}
function choose(decision) { const voice = current(); if (voice && !busy && view === 'audition') write('decision', {path:voice.path, decision}); }
$('pass').onclick = () => choose('pass'); $('keep').onclick = () => choose('keep'); $('undo').onclick = () => write('undo');
$('tab-audition').onclick = $('back-discovery').onclick = () => switchView('audition');
$('tab-favorites').onclick = $('show-selection').onclick = () => switchView('favorites');
$('clear-comparison').onclick = () => { comparison = []; stopAudio(); render(); };
function setCompareMode(mode) {
  compareMode = mode; stopAudio();
  for (const [id,value] of [['compare-clones','clone'],['compare-references','reference']]) {
    $(id).classList.toggle('chosen',mode === value); $(id).setAttribute('aria-pressed',String(mode === value));
  }
  render();
}
$('compare-clones').onclick = () => setCompareMode('clone'); $('compare-references').onclick = () => setCompareMode('reference');
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(selected().map((v,i) => ({rank:i+1,path:v.path, url:v.url, reference_note:drafts.get(v.path+':reference') ?? v.reference_note,clone_note:drafts.get(v.path+':clone') ?? v.clone_note})),null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'voix-francaises-selection.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener('play', event => { if (/^(AUDIO|VIDEO)$/.test(event.target.tagName)) { document.querySelectorAll('audio,video').forEach(a => { if (a !== event.target) a.pause(); }); $('voice-card').classList.toggle('playing', event.target === $('main-audio')); } }, true);
$('main-audio').addEventListener('pause', () => $('voice-card').classList.remove('playing'));
$('main-audio').addEventListener('ended', () => $('voice-card').classList.remove('playing'));
document.addEventListener('error', event => { if (event.target.tagName === 'AUDIO') showError('Cet audio ne se charge pas. Vérifie le serveur local ou, pour une référence originale, la connexion à Hugging Face. Aucun choix n’a été modifié.'); }, true);
document.addEventListener('keydown', event => {
  if (view !== 'audition' || busy || !current() || /INPUT|TEXTAREA|SELECT|AUDIO/.test(document.activeElement.tagName)) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); choose('pass'); }
  if (event.key === 'ArrowRight') { event.preventDefault(); choose('keep'); }
  if (event.code === 'Space' && document.activeElement.tagName !== 'BUTTON') { event.preventDefault(); const audio = $('main-audio'); if (audio.paused) audio.play().catch(() => showError('Lecture impossible. Réessaie avec le lecteur.')); else audio.pause(); }
});
const card = $('voice-card');
card.addEventListener('pointerdown', event => {
  if (busy || event.button !== 0 || event.target.closest('audio,a,button')) return;
  drag = {x:event.clientX, y:event.clientY, id:event.pointerId}; card.setPointerCapture(event.pointerId);
});
card.addEventListener('pointermove', event => {
  if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) { drag = null; card.style.transform = ''; $('gesture-label').textContent = ''; return; }
  card.style.transform = `translateX(${Math.max(-110,Math.min(110,dx))}px) rotate(${dx/24}deg)`;
  $('gesture-label').textContent = Math.abs(dx) > 45 ? (dx > 0 ? 'GARDER ♡' : 'PASSER ×') : '';
});
function finishDrag(event, cancel = false) {
  if (!drag) return; const dx = event.clientX - drag.x; drag = null; card.style.transform = ''; $('gesture-label').textContent = '';
  if (!cancel && Math.abs(dx) >= 85) choose(dx > 0 ? 'keep' : 'pass');
}
card.addEventListener('pointerup', event => finishDrag(event)); card.addEventListener('pointercancel', event => finishDrag(event, true));
window.addEventListener('hashchange', () => switchView(location.hash === '#favorites' ? 'favorites' : 'audition'));
switchView(location.hash === '#favorites' ? 'favorites' : 'audition');
load().catch(error => { showError(error.message); $('save-status').textContent = 'Connexion impossible'; });
refreshBenchmarks();
setInterval(refreshBenchmarks,5000);
