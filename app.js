/* ============================================================
   ПЕСНИ ДЛЯ ВСЕХ ИГРОКОВ лежат в файле songs.json
   Формат: { "yt": "ID видео", "artist": "...", "title": "...", "start": секунды }
   ============================================================ */
let BUILTIN_SONGS = [];

/* Ссылка на редактирование songs.json на GitHub.
   На GitHub Pages (ник.github.io/репозиторий) определяется сама.
   Если сайт живёт по другому адресу — впиши вручную:
   'https://github.com/ТВОЙ-НИК/irlar/edit/main/songs.json'  */
const GITHUB_EDIT_URL = (() => {
  const h = location.hostname;
  if (!h.endsWith('.github.io')) return '';
  const owner = h.replace('.github.io', '');
  const repo = location.pathname.split('/').filter(Boolean)[0] || h;
  return `https://github.com/${owner}/${repo}/edit/main/songs.json`;
})();

/* ====== НАСТРОЙКИ ИГРЫ ====== */
const STEPS = [0.5, 1, 2, 4, 8, 15];            // длина отрывка на каждой попытке, сек
const POINTS = [1000, 850, 700, 550, 400, 250]; // очки за угадывание с 1-й…6-й попытки
const ROUND_SIZE = 5;                       // песен за игру
const REVEAL_SEC = 15;                      // сколько играет после ответа
const PREVIEW_SEC = 3;                      // проверка на экране «Песни»

/* ====== ПОМОЩНИКИ ====== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s || '').toLowerCase()
  .replace(/ё/g,'е').replace(/ө/g,'о').replace(/ү/g,'у').replace(/ң/g,'н')
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const fmtSec = x => String(x).replace('.', ',') + ' с';
const fmtTime = sec => { sec = Math.max(0, Math.round(sec||0)); return Math.floor(sec/60) + ':' + String(sec%60).padStart(2,'0'); };
function parseTime(str){
  str = String(str ?? '').trim(); if (!str) return 0;
  if (/^\d+(\.\d+)?$/.test(str)) return +str;
  const p = str.split(':').map(Number); if (p.some(isNaN)) return NaN;
  return p.reduce((a,b) => a*60 + b, 0);
}
function parseYouTube(input){
  const s = String(input || '').trim();
  let id = null;
  const m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/);
  if (m) id = m[1]; else if (/^[\w-]{11}$/.test(s)) id = s;
  if (!id) return null;
  let start = null;
  const t = s.match(/[?&#](?:t|start)=([\dhms]+)/);
  if (t){
    const v = t[1];
    if (/^\d+$/.test(v)) start = +v;
    else {
      const g = r => +((v.match(r) || [0,0])[1]);
      start = g(/(\d+)h/)*3600 + g(/(\d+)m/)*60 + g(/(\d+)s/);
    }
  }
  return { id, start };
}
const thumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
function shuffle(a){ for (let i = a.length-1; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
let toastTimer;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800); }

/* ====== СПИСОК ПЕСЕН ====== */
const LS_SONGS = 'irlar.songs.v1', LS_REMOVED = 'irlar.removed.v1', LS_BEST = 'irlar.best.v1', LS_ADMIN = 'irlar.admin.v1';

/* Режим автора: открой сайт с #admin в конце адреса (…github.io/irlar/#admin),
   и появится кнопка «Песни». Обычные игроки её не видят. #player — выключить. */
const isAdmin = () => document.body.classList.contains('admin');
function applyAdmin(){
  if (location.hash === '#admin') store.set(LS_ADMIN, true);
  if (location.hash === '#player') store.set(LS_ADMIN, false);
  document.body.classList.toggle('admin', !!store.get(LS_ADMIN, false));
  if (!isAdmin() && document.querySelector('#screen-songs.active')) show('home');
  else if (document.querySelector('#screen-home.active')) renderHome();
}
window.addEventListener('hashchange', applyAdmin);
let library = [];

function makeSong(o){
  const p = parseYouTube(o.yt || o.url);
  if (!p || !String(o.artist||'').trim() || !String(o.title||'').trim()) return null;
  const start = Number.isFinite(+o.start) && o.start !== '' && o.start != null ? Math.max(0, +o.start) : (p.start || 0);
  return { id: p.id, yt: p.id, artist: String(o.artist).trim(), title: String(o.title).trim(), start, broken: !!o.broken };
}
function loadLibrary(){
  const saved = store.get(LS_SONGS, null);
  const removed = new Set(store.get(LS_REMOVED, []));
  library = Array.isArray(saved) ? saved.map(makeSong).filter(Boolean) : [];
  const have = new Set(library.map(s => s.id));
  for (const b of BUILTIN_SONGS){
    const s = makeSong(b);
    if (s && !have.has(s.id) && !removed.has(s.id)){ library.push(s); have.add(s.id); }
  }
}
function saveLibrary(){ store.set(LS_SONGS, library); }
function upsertSong(s){
  const i = library.findIndex(x => x.id === s.id);
  if (i >= 0) library[i] = s; else library.push(s);
  const removed = store.get(LS_REMOVED, []).filter(id => id !== s.id); store.set(LS_REMOVED, removed);
  saveLibrary();
  return i < 0;
}
function removeSong(id){
  library = library.filter(s => s.id !== id); saveLibrary();
  const removed = new Set(store.get(LS_REMOVED, [])); removed.add(id); store.set(LS_REMOVED, [...removed]);
}

/* ====== ПЛЕЕР YOUTUBE ======
   Видео спрятано, играет только звук. Отрывок останавливается по таймеру,
   который запускается в момент, когда YouTube реально начал играть
   (после загрузки), поэтому 0,5 с — это именно 0,5 с звука. */
const Player = {
  yt: null, ready: false, queue: [], current: null,
  warming: false, playing: false, stopAt: 0, t0: 0, p0: 0,
  stopTimer: 0, warmTimer: 0, raf: 0, onTick: null, onStop: null, onWarm: null,
  onErr: null,

  init(){
    window.onYouTubeIframeAPIReady = () => {
      this.yt = new YT.Player('yt', {
        width: 240, height: 135,
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3, modestbranding: 1 },
        events: {
          onReady: () => { this.ready = true; clearTimeout(this.failTimer); this.queue.splice(0).forEach(f => f()); },
          onStateChange: e => this._state(e.data),
          onError: e => this._error(e.data)
        }
      });
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => showYtProblem('load');
    document.head.appendChild(s);
    this.failTimer = setTimeout(() => { if (!this.ready) showYtProblem('load'); }, 12000);
  },
  whenReady(f){ this.ready ? f() : this.queue.push(f); },

  // загрузить песню и заранее прогрузить начало (без звука)
  load(song, onWarm){
    this.whenReady(() => {
      this.stop(true);
      this.current = song; this.warming = true; this.onWarm = onWarm || null;
      this.yt.mute();
      this.yt.loadVideoById({ videoId: song.yt, startSeconds: song.start });
      clearTimeout(this.warmTimer);
      this.warmTimer = setTimeout(() => { if (this.warming) this._warmDone(); }, 6000);
    });
  },
  _warmDone(){
    this.warming = false; clearTimeout(this.warmTimer);
    try { this.yt.pauseVideo(); this.yt.seekTo(this.current.start, true); } catch(e){}
    const f = this.onWarm; this.onWarm = null; f && f();
  },

  // сыграть отрывок длиной dur секунд от начала песни
  play(dur, { onTick, onStop } = {}){
    if (!this.current) return;
    this.whenReady(() => {
      this.stop(true);
      if (this.warming){ this.warming = false; clearTimeout(this.warmTimer); this.onWarm = null; try { this.yt.pauseVideo(); } catch(e){} }
      this.playing = true; this.gotPlaying = false; this.stopAt = this.current.start + dur;
      this.onTick = onTick || null; this.onStop = onStop || null;
      this.yt.unMute(); this.yt.setVolume(100);
      this.yt.seekTo(this.current.start, true);
      this.yt.playVideo();
      this._fallback();
    });
  },
  // если YouTube не прислал событие «играет», а звук уже идёт — считаем от текущего момента
  _fallback(){
    clearTimeout(this.fbTimer);
    this.fbTimer = setTimeout(() => {
      if (this.playing && !this.gotPlaying && this.yt.getPlayerState() === 1) this._onPlaying();
      else if (this.playing && !this.gotPlaying) this._fallback();
    }, 700);
  },

  // проверка песни на экране «Песни»
  preview(song, { onStop } = {}){
    this.whenReady(() => {
      this.stop(true);
      this.current = song; this.warming = false;
      this.playing = true; this.gotPlaying = false; this.stopAt = song.start + PREVIEW_SEC; this.onTick = null; this.onStop = onStop || null;
      this.yt.unMute(); this.yt.setVolume(100);
      this.yt.loadVideoById({ videoId: song.yt, startSeconds: song.start });
      this._fallback();
    });
  },

  stop(silent){
    clearTimeout(this.stopTimer); clearTimeout(this.fbTimer); cancelAnimationFrame(this.raf);
    if (!this.playing) return;
    this.playing = false;
    try { this.yt.pauseVideo(); this.yt.seekTo(this.current.start, true); } catch(e){}
    const f = this.onStop; this.onStop = null; this.onTick = null;
    if (!silent && f) f();
  },

  _state(s){
    const S = (window.YT && YT.PlayerState) || { PLAYING: 1, PAUSED: 2, BUFFERING: 3, ENDED: 0 };
    if (s === S.PLAYING){
      if (this.warming){ this._warmDone(); return; }
      if (!this.playing) return;
      this._onPlaying();
    } else if (this.playing && this.gotPlaying && s === S.BUFFERING){
      clearTimeout(this.stopTimer); cancelAnimationFrame(this.raf); // ждём, пока догрузится
    } else if (this.playing && this.gotPlaying && (s === S.ENDED || s === S.PAUSED)){
      this.stop();
    }
  },
  _onPlaying(){
      this.gotPlaying = true; clearTimeout(this.fbTimer);
      let t = this.yt.getCurrentTime();
      if (!(t >= this.current.start && t < this.stopAt - 0.02)) t = Math.max(this.current.start, Math.min(t, this.stopAt));
      if (t >= this.stopAt - 0.02) t = this.current.start; // устаревшее время после перемотки
      this.t0 = t; this.p0 = performance.now();
      clearTimeout(this.stopTimer);
      this.stopTimer = setTimeout(() => this.stop(), Math.max(0, (this.stopAt - t) * 1000));
      const loop = () => {
        if (!this.playing) return;
        const el = this.t0 - this.current.start + (performance.now() - this.p0) / 1000;
        this.onTick && this.onTick(Math.min(el, this.stopAt - this.current.start));
        this.raf = requestAnimationFrame(loop);
      };
      cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(loop);
  },
  _error(code){
    const song = this.current;
    this.warming = false; clearTimeout(this.warmTimer);
    const wasPlaying = this.playing; this.playing = false; clearTimeout(this.stopTimer); cancelAnimationFrame(this.raf);
    const f = this.onStop; this.onStop = null; if (wasPlaying && f) f();
    if (code === 153) showYtProblem('referrer');
    this.onErr && this.onErr(code, song);
  }
};

function showYtProblem(kind){
  const b = $('#yt-banner');
  b.innerHTML = kind === 'referrer'
    ? '<b>YouTube не даёт играть видео.</b> Скорее всего, сайт открыт двойным кликом по файлу. Открой его по ссылке GitHub Pages (вида ник.github.io/irlar) — тогда всё заработает.'
    : '<b>Не получилось загрузить YouTube.</b> Проверь интернет. Если сайт открыт двойным кликом по файлу — открой его по ссылке GitHub Pages (ник.github.io/irlar).';
  b.classList.add('show');
}
const ytErrorText = c => ({
  2: 'неправильная ссылка', 5: 'ошибка плеера', 100: 'видео удалено или скрыто',
  101: 'автор запретил встраивать видео', 150: 'автор запретил встраивать видео', 153: 'YouTube не принимает этот сайт'
}[c] || 'видео не играет');

/* ====== ЭКРАНЫ ====== */
function show(name){
  if (name === 'songs' && !isAdmin()) name = 'home';
  Player.stop(true);
  $('#toast').classList.remove('show');
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  if (name === 'home') renderHome();
  if (name === 'songs') renderSongs();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));

function renderHome(){
  const playable = library.filter(s => !s.broken).length;
  $('#st-count').textContent = library.length;
  const best = store.get(LS_BEST, null);
  $('#st-best').textContent = best == null ? '—' : best;
  $('#btn-songs').textContent = `Песни (${library.length})`;
  const btn = $('#btn-play');
  btn.disabled = playable === 0 && !isAdmin();
  btn.textContent = playable === 0 ? (isAdmin() ? 'Сначала добавь песни' : 'Песни скоро появятся') : (playable < ROUND_SIZE ? `Играть (${playable} из ${ROUND_SIZE} песен)` : 'Играть');
}
$('#ladder').innerHTML = STEPS.map(s => `<span>${fmtSec(s)}</span>`).join('<span style="border:0;background:none;padding:5px 0">→</span>');

/* ====== ИГРА ====== */
let G = null;
const MAXLEN = STEPS[STEPS.length - 1];
// шкала «сжатая» (корень), чтобы короткие отрезки 0,5 и 1 с были видны рядом с 15 с
const pos = t => Math.sqrt(Math.max(0, t) / MAXLEN) * 100;

function startGame(){
  const pool = library.filter(s => !s.broken);
  if (!pool.length){ toast('Сначала добавь песни'); show('songs'); return; }
  G = { songs: shuffle(pool.slice()).slice(0, ROUND_SIZE), i: 0, results: [], score: 0 };
  show('game');
  startSong();
}
function startSong(){
  const song = G.songs[G.i];
  G.cur = { song, step: 0, guesses: [], done: false, solved: false, warm: false };
  selected = null; $('#g-input').value = ''; hideSugg();
  renderGame();
  Player.load(song, () => { if (G && G.cur && G.cur.song === song){ G.cur.warm = true; renderPlayLabel(); } });
}
Player.onErr = (code, song) => {
  if (song){ const s = library.find(x => x.id === song.id); if (s && code !== 153){ s.broken = true; saveLibrary(); } }
  if (!G || !G.cur || !song || G.cur.song.id !== song.id || G.cur.done) { if ($('#screen-songs').classList.contains('active')){ setMsg('#f-msg', 'Не играет: ' + ytErrorText(code), 'err'); renderSongs(); } return; }
  if (code === 153) return;
  toast(`«${song.title}» не играет (${ytErrorText(code)}) — беру другую`);
  const used = new Set(G.songs.map(s => s.id));
  const repl = shuffle(library.filter(s => !s.broken && !used.has(s.id)))[0];
  if (repl){ G.songs[G.i] = repl; startSong(); }
  else {
    G.songs.splice(G.i, 1);
    if (!G.songs.length){ show('home'); return; }
    if (G.i >= G.songs.length) showResult(); else startSong();
  }
};

function renderGame(){
  const c = G.cur;
  $('#g-counter').textContent = `Песня ${G.i + 1} из ${G.songs.length}`;
  $('#g-score').textContent = G.score + ' очк.';
  $('#g-dots').innerHTML = G.songs.map((_, k) => {
    const r = G.results[k];
    return `<span class="${r ? (r.solved ? 'ok' : 'fail') : (k === G.i ? 'cur' : '')}"></span>`;
  }).join('');

  $('#g-attempts').innerHTML = STEPS.map((len, k) => {
    const g = c.guesses[k];
    if (g){
      const label = g.kind === 'skip' ? 'Пропущено' : esc(g.choice.artist + ' — ' + g.choice.title);
      const tag = g.kind === 'part' ? '<span class="tag">исполнитель ✓</span>' : g.kind === 'bad' ? '<span class="tag">мимо</span>' : g.kind === 'ok' ? '<span class="tag">да!</span>' : '';
      return `<div class="att ${g.kind}"><span class="len">${fmtSec(len)}</span><span class="txt">${label}</span>${tag}</div>`;
    }
    const cur = !c.done && k === c.guesses.length;
    return `<div class="att ${cur ? 'current' : ''}"><span class="len">${fmtSec(len)}</span><span class="txt muted">${cur ? 'Твой ответ…' : ''}</span></div>`;
  }).join('');

  // шкала
  const unlocked = c.done ? MAXLEN : STEPS[c.step];
  $('#g-unlocked').style.width = pos(unlocked) + '%';
  $('#g-prog').style.width = '0';
  const tl = $('#g-timeline');
  tl.querySelectorAll('.tick').forEach(t => t.remove());
  STEPS.slice(0, -1).forEach(s => { const d = document.createElement('div'); d.className = 'tick'; d.style.left = `calc(${pos(s)}% - 1px)`; tl.appendChild(d); });
  $('#g-ticks').innerHTML = STEPS.map(s => `<span style="left:${Math.min(97, Math.max(3, pos(s)))}%">${String(s).replace('.', ',')}</span>`).join('');

  const nextStep = STEPS[c.guesses.length + 1];
  $('#g-skip').textContent = nextStep ? `Пропуск +${fmtSec(nextStep - STEPS[c.step])}` : 'Сдаться';
  $('#g-answer').disabled = !selected;
  setPlaying(false);
  renderPlayLabel();

  $('#g-play-area').style.display = c.done ? 'none' : '';
  $('#g-reveal').style.display = c.done ? '' : 'none';
  if (c.done) renderReveal();
}
function renderPlayLabel(){
  const c = G.cur; if (!c || c.done) return;
  $('#g-playlabel').textContent = Player.playing ? 'Играет…' : (!Player.ready ? 'Загружаю плеер…' : `Слушать ${fmtSec(STEPS[c.step])}`);
  $('#g-playbtn').disabled = !Player.ready;
}
function setPlaying(on){
  $('#ico-play').style.display = on ? 'none' : '';
  $('#ico-stop').style.display = on ? '' : 'none';
  if (!on) $('#g-prog').style.width = '0';
}
Player.whenReady(() => { if (G && G.cur) renderPlayLabel(); });

$('#g-playbtn').addEventListener('click', () => {
  const c = G.cur; if (!c || c.done) return;
  if (Player.playing){ Player.stop(); return; }
  setPlaying(true);
  Player.play(STEPS[c.step], {
    onTick: t => { $('#g-prog').style.width = pos(t) + '%'; },
    onStop: () => { setPlaying(false); renderPlayLabel(); }
  });
  $('#g-playlabel').textContent = 'Играет…';
});

function registerGuess(choice){
  const c = G.cur; if (!c || c.done) return;
  Player.stop(true);
  let kind;
  if (!choice) kind = 'skip';
  else if (choice.id === c.song.id) kind = 'ok';
  else if (norm(choice.artist) === norm(c.song.artist)) kind = 'part';
  else kind = 'bad';
  c.guesses.push({ choice, kind });
  if (kind === 'ok') finishSong(true);
  else if (c.guesses.length >= STEPS.length) finishSong(false);
  else c.step = c.guesses.length;
  selected = null; $('#g-input').value = ''; hideSugg();
  renderGame();
  if (!c.done && kind !== 'ok'){
    if (kind === 'skip') toast(`Отрывок теперь ${fmtSec(STEPS[c.step])}`);
  }
}
function finishSong(solved){
  const c = G.cur; c.done = true; c.solved = solved;
  const pts = solved ? POINTS[c.guesses.length - 1] : 0;
  G.score += pts;
  G.results.push({ song: c.song, guesses: c.guesses, solved, points: pts });
}
function renderReveal(){
  const c = G.cur, r = G.results[G.results.length - 1];
  $('#r-cover').style.backgroundImage = `url(${thumb(c.song.yt).replace('mqdefault', 'hqdefault')})`;
  $('#r-title').textContent = c.song.title;
  $('#r-artist').textContent = c.song.artist;
  const v = $('#r-verdict');
  if (c.solved){ v.className = 'verdict ok'; v.textContent = `Угадал с ${c.guesses.length}-й попытки! +${r.points}`; }
  else { v.className = 'verdict fail'; v.textContent = 'Не угадал'; }
  $('#r-link').href = `https://www.youtube.com/watch?v=${c.song.yt}&t=${Math.floor(c.song.start)}s`;
  $('#r-next').textContent = G.i + 1 >= G.songs.length ? 'Итоги →' : 'Следующая →';
  $('#r-listen').textContent = '▶ Послушать';
}
$('#r-listen').addEventListener('click', () => {
  if (Player.playing){ Player.stop(); return; }
  $('#r-listen').textContent = '■ Стоп';
  Player.play(REVEAL_SEC, { onStop: () => { $('#r-listen').textContent = '▶ Послушать'; } });
});
$('#r-next').addEventListener('click', () => {
  Player.stop(true);
  G.i++;
  if (G.i >= G.songs.length) showResult(); else startSong();
});
$('#g-skip').addEventListener('click', () => registerGuess(null));
$('#g-answer').addEventListener('click', () => { if (selected) registerGuess(selected); });
$('#btn-play').addEventListener('click', startGame);

/* ====== ПОДСКАЗКИ ПРИ ВВОДЕ ====== */
let selected = null, suggItems = [], hl = -1;
const input = $('#g-input');
function hideSugg(){ $('#g-sugg').classList.remove('show'); suggItems = []; hl = -1; }
function renderSugg(){
  const box = $('#g-sugg');
  const q = norm(input.value);
  if (!q){ hideSugg(); return; }
  const tokens = q.split(' ');
  const guessed = new Set((G.cur?.guesses || []).filter(g => g.choice).map(g => g.choice.id));
  suggItems = library
    .filter(s => !guessed.has(s.id))
    .filter(s => { const h = norm(s.artist + ' ' + s.title); return tokens.every(t => h.includes(t)); })
    .sort((a, b) => (norm(a.title).startsWith(q) ? 0 : 1) - (norm(b.title).startsWith(q) ? 0 : 1))
    .slice(0, 8);
  hl = suggItems.length ? 0 : -1;
  box.innerHTML = suggItems.length
    ? suggItems.map((s, k) => `<button data-k="${k}" class="${k === hl ? 'hl' : ''}">${esc(s.title)} <span class="a">— ${esc(s.artist)}</span></button>`).join('')
    : '<div class="empty">Такой песни нет в списке</div>';
  box.classList.add('show');
}
function pick(k){
  const s = suggItems[k]; if (!s) return;
  selected = s; input.value = `${s.title} — ${s.artist}`;
  hideSugg(); $('#g-answer').disabled = false;
}
input.addEventListener('input', () => { selected = null; $('#g-answer').disabled = true; renderSugg(); });
input.addEventListener('focus', () => { if (!selected && input.value) renderSugg(); });
input.addEventListener('keydown', e => {
  const box = $('#g-sugg');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    if (!suggItems.length) return; e.preventDefault();
    hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + suggItems.length) % suggItems.length;
    box.querySelectorAll('button').forEach((b, k) => b.classList.toggle('hl', k === hl));
  } else if (e.key === 'Enter'){
    e.preventDefault();
    if (selected) registerGuess(selected);
    else if (hl >= 0) pick(hl);
  } else if (e.key === 'Escape') hideSugg();
});
$('#g-sugg').addEventListener('mousedown', e => e.preventDefault());
$('#g-sugg').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) pick(+b.dataset.k); });
document.addEventListener('click', e => { if (!e.target.closest('.guess-box')) hideSugg(); });

/* ====== ИТОГИ ====== */
const sqFor = g => ({ ok: '🟩', part: '🟨', bad: '🟥', skip: '⬛' }[g.kind]);
function showResult(){
  const max = G.songs.length * POINTS[0];
  const prevBest = store.get(LS_BEST, null);
  const isBest = prevBest == null || G.score > prevBest;
  if (isBest) store.set(LS_BEST, G.score);
  show('result');
  $('#res-total').textContent = G.score;
  $('#res-best').textContent = isBest && G.score > 0 ? 'Новый рекорд!' : `из ${max} · рекорд: ${Math.max(prevBest ?? 0, G.score)}`;
  $('#res-list').innerHTML = G.results.map(r => `
    <div class="res-item">
      <div class="t"><div><b>${esc(r.song.title)}</b></div><div class="muted small">${esc(r.song.artist)}</div></div>
      <div class="sq">${r.guesses.map(sqFor).join('')}</div>
      <div class="p" style="color:${r.solved ? 'var(--ok)' : 'var(--muted)'}">${r.points}</div>
    </div>`).join('');
  $('#res-share-text').style.display = 'none';
}
$('#res-again').addEventListener('click', startGame);
$('#res-share').addEventListener('click', async () => {
  const max = G.songs.length * POINTS[0];
  const text = `ЫРЛАР 🎵 ${G.score}/${max}\n` + G.results.map((r, k) => `${k + 1}. ${r.guesses.map(sqFor).join('')}`).join('\n');
  try { await navigator.clipboard.writeText(text); toast('Скопировано — отправь друзьям'); }
  catch(e){ const t = $('#res-share-text'); t.value = text; t.style.display = 'block'; t.select(); toast('Скопируй текст вручную'); }
});

/* ====== ЭКРАН «ПЕСНИ» ====== */
let editingId = null, startTouched = false;
function setMsg(sel, text, kind){ const m = $(sel); m.textContent = text || ''; m.className = 'form-msg' + (kind ? ' ' + kind : ''); }
function readForm(){
  const p = parseYouTube($('#f-url').value);
  const start = parseTime($('#f-start').value);
  return { p, start, artist: $('#f-artist').value.trim(), title: $('#f-title').value.trim() };
}
$('#f-url').addEventListener('input', () => {
  const p = parseYouTube($('#f-url').value);
  const pv = $('#f-preview');
  if (p){
    pv.classList.add('show');
    $('#f-thumb').src = thumb(p.id);
    $('#f-preview-text').textContent = 'Видео найдено ✓';
    if (p.start != null && !startTouched) $('#f-start').value = fmtTime(p.start);
    const dup = library.find(s => s.id === p.id);
    if (dup && dup.id !== editingId) setMsg('#f-msg', `Эта песня уже есть: ${dup.artist} — ${dup.title}`, 'err'); else setMsg('#f-msg', '');
  } else {
    pv.classList.remove('show');
    setMsg('#f-msg', $('#f-url').value.trim() ? 'Не похоже на ссылку YouTube' : '', $('#f-url').value.trim() ? 'err' : '');
  }
});
$('#f-start').addEventListener('input', () => { startTouched = true; });
$('#f-test').addEventListener('click', () => {
  const f = readForm();
  if (!f.p){ setMsg('#f-msg', 'Сначала вставь ссылку на YouTube', 'err'); return; }
  if (isNaN(f.start)){ setMsg('#f-msg', 'Время начала пиши так: 0:12', 'err'); return; }
  if (Player.playing){ Player.stop(); return; }
  setMsg('#f-msg', 'Играет начало…');
  $('#f-test').textContent = '■ Стоп';
  Player.preview({ id: f.p.id, yt: f.p.id, start: f.start, title: f.title || 'песня' }, {
    onStop: () => { $('#f-test').textContent = '▶ Проверить'; if ($('#f-msg').textContent === 'Играет начало…') setMsg('#f-msg', ''); }
  });
});
$('#f-save').addEventListener('click', () => {
  const f = readForm();
  if (!f.p) return setMsg('#f-msg', 'Вставь ссылку на YouTube', 'err');
  if (!f.artist) return setMsg('#f-msg', 'Напиши исполнителя', 'err');
  if (!f.title) return setMsg('#f-msg', 'Напиши название песни', 'err');
  if (isNaN(f.start)) return setMsg('#f-msg', 'Время начала пиши так: 0:12', 'err');
  const dup = library.find(s => s.id === f.p.id);
  if (dup && dup.id !== editingId) return setMsg('#f-msg', `Эта песня уже есть: ${dup.artist} — ${dup.title}`, 'err');
  if (editingId && editingId !== f.p.id) removeSong(editingId);
  const song = makeSong({ yt: f.p.id, artist: f.artist, title: f.title, start: f.start });
  const added = upsertSong(song);
  clearForm();
  setMsg('#f-msg', added ? `Добавлено: ${song.artist} — ${song.title}` : 'Сохранено', 'ok');
  renderSongs();
});
$('#f-cancel').addEventListener('click', () => { clearForm(); setMsg('#f-msg', ''); });
function clearForm(){
  editingId = null; startTouched = false;
  ['#f-url', '#f-artist', '#f-title', '#f-start'].forEach(s => $(s).value = '');
  $('#f-preview').classList.remove('show');
  $('#f-heading').textContent = 'Добавить песню';
  $('#f-save').textContent = 'Добавить';
  $('#f-cancel').style.display = 'none';
}
function editSong(id){
  const s = library.find(x => x.id === id); if (!s) return;
  editingId = id; startTouched = true;
  $('#f-url').value = `https://youtu.be/${s.yt}`;
  $('#f-artist').value = s.artist; $('#f-title').value = s.title;
  $('#f-start').value = s.start ? fmtTime(s.start) : '';
  $('#f-preview').classList.add('show'); $('#f-thumb').src = thumb(s.yt); $('#f-preview-text').textContent = 'Редактирование';
  $('#f-heading').textContent = 'Изменить песню';
  $('#f-save').textContent = 'Сохранить';
  $('#f-cancel').style.display = '';
  setMsg('#f-msg', s.broken ? 'Это видео не играло — вставь другую ссылку' : '', s.broken ? 'err' : '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function savedState(){
  // что уже лежит в songs.json, а что есть только в этом браузере
  const saved = new Map();
  for (const b of BUILTIN_SONGS){ const x = makeSong(b); if (x) saved.set(x.id, x); }
  const unsaved = new Set();
  for (const s of library){
    const b = saved.get(s.id);
    if (!b || b.artist !== s.artist || b.title !== s.title || b.start !== s.start) unsaved.add(s.id);
  }
  const removed = [...saved.keys()].filter(id => !library.some(s => s.id === id)).length;
  return { unsaved, removed, dirty: unsaved.size + removed };
}
function exportJson(){
  const rows = library
    .slice().sort((a, b) => a.artist.localeCompare(b.artist, 'ru') || a.title.localeCompare(b.title, 'ru'))
    .map(({ yt, artist, title, start }) => '  ' + JSON.stringify({ yt, artist, title, start }));
  return '[\n' + rows.join(',\n') + '\n]\n';
}
function renderSongs(){
  const q = norm($('#list-search').value);
  const st = savedState();
  const list = library
    .filter(s => !q || norm(s.artist + ' ' + s.title).includes(q))
    .sort((a, b) => a.artist.localeCompare(b.artist, 'ru') || a.title.localeCompare(b.title, 'ru'));
  $('#list-title').textContent = `Список песен (${library.length})`;
  $('#song-list').innerHTML = list.length ? list.map(s => `
    <div class="song ${s.broken ? 'broken' : ''}" data-id="${esc(s.id)}">
      <img src="${thumb(s.yt)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="t"><div><b>${esc(s.title)}</b>${st.unsaved.has(s.id) ? ' <span class="badge">не сохранена</span>' : ''}</div><div class="a">${esc(s.artist)}${s.start ? ' · с ' + fmtTime(s.start) : ''}</div></div>
      <button class="icon-btn" data-act="play" title="Проверить">▶</button>
      <button class="icon-btn" data-act="edit" title="Изменить">✎</button>
      <button class="icon-btn btn-danger" data-act="del" title="Удалить">✕</button>
    </div>`).join('')
    : `<div class="empty-state">${library.length ? 'Ничего не найдено' : 'Пока пусто. Добавь первую песню по ссылке с YouTube.'}</div>`;
  $('#export-text').value = exportJson();
  const n = $('#save-notice');
  if (st.dirty){
    const parts = [];
    if (st.unsaved.size) parts.push(`новых или изменённых: ${st.unsaved.size}`);
    if (st.removed) parts.push(`удалённых: ${st.removed}`);
    n.innerHTML = `Игроки пока не видят изменения (${parts.join(', ')}). Открой «Сохранить для всех игроков» внизу.`;
    n.style.display = '';
  } else n.style.display = 'none';
  const gh = $('#gh-link');
  if (GITHUB_EDIT_URL){ gh.href = GITHUB_EDIT_URL; gh.style.display = ''; } else gh.style.display = 'none';
}
$('#list-search').addEventListener('input', renderSongs);
let delArmed = null;
$('#song-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.song').dataset.id;
  const s = library.find(x => x.id === id); if (!s) return;
  if (b.dataset.act === 'play'){
    if (Player.playing){ Player.stop(); return; }
    b.textContent = '■';
    Player.preview(s, { onStop: () => { b.textContent = '▶'; } });
  } else if (b.dataset.act === 'edit') editSong(id);
  else if (b.dataset.act === 'del'){
    if (delArmed !== id){ delArmed = id; b.textContent = '?'; toast('Нажми ✕ ещё раз, чтобы удалить'); setTimeout(() => { if (delArmed === id){ delArmed = null; b.textContent = '✕'; } }, 3000); return; }
    delArmed = null; removeSong(id); if (editingId === id) clearForm(); renderSongs(); toast('Удалено');
  }
});
$('#bulk-add').addEventListener('click', () => {
  const lines = $('#bulk-text').value.split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0, bad = [];
  lines.forEach((line, k) => {
    const parts = line.split(/\s*[;|\t]\s*/);
    const p = parseYouTube(parts[0]);
    const start = parts[3] ? parseTime(parts[3]) : (p && p.start) || 0;
    const s = p && parts[1] && parts[2] && !isNaN(start) ? makeSong({ yt: p.id, artist: parts[1], title: parts[2], start }) : null;
    if (!s){ bad.push(k + 1); return; }
    if (upsertSong(s)) added++;
  });
  setMsg('#bulk-msg', `Добавлено: ${added}` + (bad.length ? ` · не понял строки: ${bad.join(', ')}` : ''), bad.length ? 'err' : 'ok');
  if (!bad.length) $('#bulk-text').value = '';
  renderSongs();
});
$('#export-copy').addEventListener('click', async () => {
  const t = $('#export-text');
  try { await navigator.clipboard.writeText(t.value); toast('Скопировано'); }
  catch(e){ t.select(); toast('Выдели и скопируй вручную'); }
});

/* ====== СТАРТ ====== */
async function boot(){
  try {
    const r = await fetch('songs.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    BUILTIN_SONGS = Array.isArray(data) ? data : [];
  } catch(e){
    const b = $('#yt-banner');
    b.innerHTML = '<b>Не загрузился список песен (songs.json).</b> Сайт нужно открывать по ссылке GitHub Pages (ник.github.io/irlar), а не двойным кликом по файлу. Если ссылка правильная — проверь, что в songs.json нет ошибки (лишней запятой или кавычки).';
    b.classList.add('show');
  }
  loadLibrary();
  applyAdmin();
  renderHome();
}
Player.init();
boot();
