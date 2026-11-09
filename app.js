/* ============================================================
   ПЕСНИ ДЛЯ ВСЕХ ИГРОКОВ лежат в файле songs.json
   Формат: { "yt": "ID видео", "artist": "...", "title": "...", "start": секунды }
   ============================================================ */
let BUILTIN_SONGS = [];

/* Ссылка на редактирование songs.json на GitHub.
   На GitHub Pages (ник.github.io/репозиторий) определяется сама.
   Если сайт живёт по другому адресу — впиши вручную:
   'https://github.com/ТВОЙ-НИК/tuvmuzHOM/edit/main/songs.json'  */
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
const ROUND_SIZE = 5;                       // песен в «Песне дня» и «Рандоме»
const ARTIST_ROUND = 10;                    // песен в режиме «Артист»
const REVEAL_SEC = 15;                      // сколько играет после ответа
const PREVIEW_SEC = 3;                      // проверка на экране «Песни»
const CLIP_SEC = 20;                        // длина отрывка, который вырезается из mp3

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

/* Режим автора: открой сайт с #admin в конце адреса (…github.io/tuvmuzHOM/#admin),
   и появится кнопка «Песни». Обычные игроки её не видят. #player — выключить. */
const isAdmin = () => document.body.classList.contains('admin');
function applyAdmin(){
  if (location.hash === '#admin') store.set(LS_ADMIN, true);
  if (location.hash === '#player') store.set(LS_ADMIN, false);
  const was = isAdmin();
  document.body.classList.toggle('admin', !!store.get(LS_ADMIN, false));
  if (booted && was !== isAdmin()) loadLibrary();
  if (!isAdmin() && document.querySelector('#screen-songs.active')) show('home');
  else if (document.querySelector('#screen-home.active')) renderHome();
}
window.addEventListener('hashchange', applyAdmin);
let library = [];
let booted = false;

// Песня — это либо видео YouTube {yt}, либо свой отрывок {file: "clips/....mp3"}
function makeSong(o){
  const artist = String(o.artist || '').trim(), title = String(o.title || '').trim();
  if (!artist || !title) return null;
  if (o.file){
    const file = String(o.file).trim();
    if (!/^[\w\-./]+\.(mp3|m4a|ogg|wav)$/i.test(file)) return null;
    return { id: 'file:' + file, file, artist, title, start: 0 };
  }
  const p = parseYouTube(o.yt || o.url);
  if (!p) return null;
  const start = Number.isFinite(+o.start) && o.start !== '' && o.start != null ? Math.max(0, +o.start) : (p.start || 0);
  return { id: p.id, yt: p.id, artist, title, start };
}
function loadLibrary(){
  // игроки видят только songs.json; свои правки — только в режиме автора
  const saved = isAdmin() ? store.get(LS_SONGS, null) : null;
  const removed = new Set(isAdmin() ? store.get(LS_REMOVED, []) : []);
  library = Array.isArray(saved) ? saved.map(makeSong).filter(Boolean) : [];
  const have = new Set(library.map(s => s.id));
  for (const b of BUILTIN_SONGS){
    const s = makeSong(b);
    if (s && !have.has(s.id) && !removed.has(s.id)){ library.push(s); have.add(s.id); }
  }
}
function saveLibrary(){ if (isAdmin()) store.set(LS_SONGS, library.map(({ broken, ...rest }) => rest)); }
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

/* ====== СВОИ ОТРЫВКИ (mp3 из папки clips/) ======
   Играют через Web Audio: точный старт и точная длина, без рекламы. */
const LocalClips = { // отрывки, ещё не загруженные на GitHub, хранятся в браузере автора
  db: null,
  open(){
    if (!this.db) this.db = new Promise((res, rej) => {
      try { const r = indexedDB.open('irlar-clips', 1); r.onupgradeneeded = () => r.result.createObjectStore('clips'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
      catch(e){ rej(e); }
    });
    return this.db;
  },
  async get(k){ try { const db = await this.open(); return await new Promise(res => { const q = db.transaction('clips').objectStore('clips').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch(e){ return null; } },
  async put(k, v){ try { const db = await this.open(); await new Promise(res => { const t = db.transaction('clips', 'readwrite'); t.objectStore('clips').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch(e){} },
  async del(k){ try { const db = await this.open(); await new Promise(res => { const t = db.transaction('clips', 'readwrite'); t.objectStore('clips').delete(k); t.oncomplete = res; t.onerror = res; }); } catch(e){} }
};
const Clip = {
  ctx: null, buf: null, current: null, src: null, playing: false, ready: true,
  loading: null, token: 0, onStop: null, onTick: null, raf: 0,
  ensureCtx(){
    if (!this.ctx){ const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  async decode(arrayBuf){
    const ctx = this.ensureCtx();
    return await new Promise((res, rej) => ctx.decodeAudioData(arrayBuf, res, rej));
  },
  async fetchBuffer(song){
    let ab = null;
    if (isAdmin()){ const blob = await LocalClips.get(song.file); if (blob) ab = await blob.arrayBuffer(); }
    if (!ab){
      let r; try { r = await fetch(song.file, { cache: 'no-cache' }); } catch(e){ throw { code: 404 }; }
      if (!r.ok) throw { code: 404 };
      ab = await r.arrayBuffer();
    }
    try { return await this.decode(ab); } catch(e){ throw { code: 415 }; }
  },
  load(song, onWarm){
    this.stop(true);
    this.current = song; this.buf = null;
    const tok = ++this.token;
    this.loading = this.fetchBuffer(song).then(b => {
      if (tok !== this.token) return;
      this.buf = b; onWarm && onWarm();
    }).catch(e => {
      if (tok !== this.token) return;
      this.loading = null;
      Snd.onErr && Snd.onErr((e && e.code) || 404, song);
    });
  },
  play(dur, { onTick, onStop } = {}){
    if (!this.current) return;
    this.stop(true); this.ensureCtx();
    this.playing = true; this.onTick = onTick || null; this.onStop = onStop || null;
    const tok = this.token;
    const go = () => { if (this.playing && tok === this.token && this.buf) this._start(this.buf, this.current.start || 0, dur); };
    if (this.buf) go(); else if (this.loading) this.loading.then(go); else this.stop();
  },
  preview(song, opts = {}){ this.load(song); this.play(PREVIEW_SEC, opts); },
  // сыграть кусок любого буфера (используется и для проверки файла до сохранения)
  playRaw(buf, offset, dur, { onStop } = {}){
    this.stop(true); this.ensureCtx(); this.token++;
    this.current = null; this.buf = null;
    this.playing = true; this.onTick = null; this.onStop = onStop || null;
    this._start(buf, offset, dur);
  },
  _start(buf, offset, dur){
    const ctx = this.ctx;
    const d = Math.max(0.05, Math.min(dur, buf.duration - offset));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); src.connect(g); g.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.03;
    g.gain.setValueAtTime(1, t0); g.gain.setValueAtTime(1, t0 + Math.max(0, d - 0.03)); g.gain.linearRampToValueAtTime(0, t0 + d);
    src.start(t0, offset, d);
    this.src = src;
    src.onended = () => { if (this.src === src) this.stop(); };
    const loop = () => {
      if (!this.playing || this.src !== src) return;
      this.onTick && this.onTick(Math.max(0, Math.min(d, ctx.currentTime - t0)));
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(loop);
  },
  stop(silent){
    cancelAnimationFrame(this.raf);
    if (this.src){ const s = this.src; this.src = null; s.onended = null; try { s.stop(); } catch(e){} }
    if (!this.playing) return;
    this.playing = false;
    const f = this.onStop; this.onStop = null; this.onTick = null;
    if (!silent && f) f();
  }
};
// Общий пульт: сам выбирает YouTube или свой отрывок
const Snd = {
  eng: Player, onErr: null,
  pick(song){ const e = song && song.file ? Clip : Player; if (e !== this.eng){ this.eng.stop(true); this.eng = e; } return e; },
  load(song, onWarm){ this.pick(song).load(song, onWarm); },
  preview(song, opts){ this.pick(song).preview(song, opts); },
  play(dur, opts){ this.eng.play(dur, opts); },
  stop(silent){ Player.stop(silent); Clip.stop(silent); },
  get playing(){ return Player.playing || Clip.playing; },
  get ready(){ return this.eng.ready; }
};
Player.onErr = (code, song) => Snd.onErr && Snd.onErr(code, song);

/* ====== ПОДГОТОВКА ОТРЫВКА ИЗ MP3 ====== */
let lameLoading = null;
function loadLame(){
  if (window.lamejs) return Promise.resolve();
  if (!lameLoading) lameLoading = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'lame.min.js';
    sc.onload = res; sc.onerror = () => { lameLoading = null; rej(new Error('lame')); };
    document.head.appendChild(sc);
  });
  return lameLoading;
}
// вырезать len секунд с позиции start и закодировать в mp3 (44,1 кГц, 128 кбит/с)
async function encodeClip(buf, start, len){
  await loadLame();
  const SR = 44100, ch = Math.min(2, buf.numberOfChannels);
  const dur = Math.max(0.5, Math.min(len, buf.duration - start));
  const off = new OfflineAudioContext(ch, Math.ceil(dur * SR), SR);
  const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start(0, start, dur);
  const seg = await off.startRendering();
  const n = seg.length, fade = Math.min(n, Math.floor(0.3 * SR));
  const to16 = x => { x = Math.max(-1, Math.min(1, x)); return x < 0 ? x * 0x8000 : x * 0x7fff; };
  const chans = [];
  for (let c = 0; c < ch; c++){
    const src = seg.getChannelData(c), out = new Int16Array(n);
    for (let i = 0; i < n; i++) out[i] = to16(src[i] * (i > n - fade ? (n - i) / fade : 1));
    chans.push(out);
  }
  const enc = new lamejs.Mp3Encoder(ch, SR, 128), parts = [];
  for (let i = 0; i < n; i += 1152){
    const d = ch > 1 ? enc.encodeBuffer(chans[0].subarray(i, i + 1152), chans[1].subarray(i, i + 1152)) : enc.encodeBuffer(chans[0].subarray(i, i + 1152));
    if (d.length) parts.push(new Uint8Array(d));
  }
  const e = enc.flush(); if (e.length) parts.push(new Uint8Array(e));
  return { blob: new Blob(parts, { type: 'audio/mpeg' }), seconds: dur };
}
const TRANSLIT = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',ң:'ng',о:'o',ө:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ү:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const slug = s => String(s).toLowerCase().split('').map(c => TRANSLIT[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'song';
function clipPathFor(artist, title){
  const base = 'clips/' + slug(artist) + '-' + slug(title);
  let path = base + '.mp3', k = 2;
  while (library.some(s => s.file === path)) path = `${base}-${k++}.mp3`;
  return path;
}
const GITHUB_UPLOAD_URL = GITHUB_EDIT_URL ? GITHUB_EDIT_URL.replace(/\/edit\/main\/songs\.json$/, '/upload/main/clips') : '';

function showYtProblem(kind){
  const b = $('#yt-banner');
  b.innerHTML = kind === 'referrer'
    ? '<b>YouTube не даёт играть видео.</b> Скорее всего, сайт открыт двойным кликом по файлу. Открой его по ссылке GitHub Pages (вида ник.github.io/tuvmuzHOM) — тогда всё заработает.'
    : '<b>Не получилось загрузить YouTube.</b> Проверь интернет. Если сайт открыт двойным кликом по файлу — открой его по ссылке GitHub Pages (ник.github.io/tuvmuzHOM).';
  b.classList.add('show');
}
const ytErrorText = c => ({
  2: 'неправильная ссылка', 5: 'ошибка плеера', 100: 'видео удалено или скрыто',
  101: 'автор запретил встраивать видео', 150: 'автор запретил встраивать видео', 153: 'YouTube не принимает этот сайт',
  404: 'файл не найден — загружен ли он в clips/?', 415: 'файл повреждён или не аудио'
}[c] || 'не играет');

/* ====== НАВИГАЦИЯ ====== */
const PARENT = { home: null, daily: 'home', solo: 'home', duo: 'home', artists: 'solo', artist: 'artists', songs: 'home', game: null, result: null };
let curScreen = 'home';
function show(name){
  if (name === 'songs' && !isAdmin()) name = 'home';
  Snd.stop(true);
  $('#toast').classList.remove('show');
  curScreen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  document.body.classList.toggle('on-home', name === 'home');
  document.body.classList.toggle('wide', name === 'artists');
  document.body.classList.toggle('has-back', !!PARENT[name]);
  if (name === 'home') renderHome();
  if (name === 'daily') renderDaily();
  if (name === 'solo') renderSolo();
  if (name === 'artists') renderArtists();
  if (name === 'songs') renderSongs();
  window.scrollTo(0, 0);
}
function goBack(){ show(PARENT[curScreen] || 'home'); }
$('#backArrow').addEventListener('click', goBack);
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
document.querySelectorAll('.mi').forEach(m => m.addEventListener('mouseenter', () => {
  document.querySelectorAll('.mi').forEach(x => x.classList.toggle('sel', x === m));
}));
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return n + ' ' + (a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many);
};
const fmtHMS = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [s / 3600 | 0, (s % 3600) / 60 | 0, s % 60].map(x => String(x).padStart(2, '0')).join(':'); };

/* ====== ПЕСНЯ ДНЯ: 5 одинаковых для всех песен, новые в 00:00 ====== */
const DAY_TZ = 7;                                  // часовой пояс Тувы и Красноярска (UTC+7)
const LAUNCH_DAY = Date.UTC(2026, 10, 10) / 864e5; // 10.11.2026 — выпуск №1
const LS_DAILY = 'irlar.daily.v1';
const dayNumber = () => Math.floor((Date.now() + DAY_TZ * 3600e3) / 864e5);
const issueNo = () => Math.max(1, dayNumber() - LAUNCH_DAY + 1);
const msToNextDay = () => (dayNumber() + 1) * 864e5 - DAY_TZ * 3600e3 - Date.now();
function seeded(seed){ // предсказуемый «случай»: у всех в один день одинаковый
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// взять n песен, стараясь, чтобы исполнители не повторялись
function pickDistinct(pool, n){
  const out = [], seen = new Set();
  for (const s of pool){ if (out.length >= n) break; const k = norm(s.artist); if (!seen.has(k)){ out.push(s); seen.add(k); } }
  for (const s of pool){ if (out.length >= n) break; if (!out.includes(s)) out.push(s); }
  return out;
}
function dailySongs(){
  const pool = library.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const rnd = seeded(dayNumber() * 7919);
  for (let i = pool.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pickDistinct(pool, ROUND_SIZE);
}
const dailyToday = () => { const d = store.get(LS_DAILY, null); return d && d.day === dayNumber() ? d : null; };
function renderDaily(){
  const n = issueNo(), done = dailyToday();
  $('#daily-big').textContent = '№' + n;
  $('#daily-title').textContent = 'Выпуск №' + n;
  $('#daily-text').textContent = done ? 'Ты уже сыграл сегодняшний выпуск' : `${ROUND_SIZE} песен — одинаковые у всех сегодня`;
  $('#daily-done').style.display = done ? '' : 'none';
  if (done) $('#daily-done').innerHTML = `Твой счёт: <b>${done.score}</b> из ${done.max}<br>${done.sq.join(' ')}`;
  $('#daily-cd').style.display = done ? '' : 'none';
  const btn = $('#daily-play');
  btn.style.display = done ? 'none' : '';
  btn.disabled = !library.length;
  btn.textContent = library.length ? '▶ Играть' : 'Песни скоро появятся';
  $('#daily-replay').style.display = done ? '' : 'none';
}
$('#daily-play').addEventListener('click', () => startGame('daily'));
$('#daily-replay').addEventListener('click', () => startGame('daily'));

/* ====== ГЛАВНАЯ И СОЛО ====== */
function renderHome(){
  const done = dailyToday();
  $('#mi-daily-sub').textContent = done
    ? `Сегодня: ${done.score} очков · новые через ${fmtHMS(msToNextDay()).slice(0, 5)}`
    : `${ROUND_SIZE} песен для всех · новые каждый день`;
  $('#st-count').textContent = library.length;
  $('#st-artists').textContent = artistList().length;
  const best = store.get(LS_BEST, null);
  $('#st-best').textContent = best == null ? '—' : best;
  $('#btn-songs').textContent = `Песни (${library.length})`;
}
function renderSolo(){ $('#solo-artists-count').textContent = plural(artistList().length, 'артист', 'артиста', 'артистов'); }
$('#solo-random').addEventListener('click', () => startGame('random'));

/* ====== АРТИСТЫ ====== */
// Фото артистов: файл artists.json вида {"Enamor": "artists/enamor.jpg"}, картинки — в папке artists/
let ARTIST_PHOTOS = {};
const ART_COLORS = ['#ffc629', '#2f7bff', '#ffffff', '#6fb1ff', '#ff9a3c', '#8fd0ff', '#ffe08a', '#4a8cff'];
function artistList(){
  const map = new Map();
  for (const s of library){
    const k = norm(s.artist);
    if (!map.has(k)) map.set(k, { key: k, name: s.artist, songs: [] });
    map.get(k).songs.push(s);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
function colorFor(key){ let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ART_COLORS[h % ART_COLORS.length]; }
const photoFor = name => ARTIST_PHOTOS[name] || null;
function renderArtists(){
  const q = norm($('#art-search').value);
  const all = artistList(), list = all.filter(a => !q || norm(a.name).includes(q));
  $('#art-count').textContent = plural(list.length, 'артист', 'артиста', 'артистов');
  $('#artist-grid').innerHTML = list.map(a => {
    const c = colorFor(a.key), p = photoFor(a.name);
    const bg = p ? `background-image:url('${esc(p)}')` : `background:radial-gradient(circle at 30% 25%, ${c}cc, transparent 60%), linear-gradient(160deg,#1a3e9e,#0b1430)`;
    return `<button class="artist" data-k="${esc(a.key)}">
      <div class="photo" style="${bg}">${p ? '' : `<span class="ini">${esc(a.name[0] || '?')}</span>`}</div>
      <b>${esc(a.name)}</b><span>${plural(a.songs.length, 'песня', 'песни', 'песен')}</span></button>`;
  }).join('') || `<div class="empty-state">${all.length ? 'Никого не нашли' : 'Артисты появятся, когда будут песни'}</div>`;
}
$('#art-search').addEventListener('input', renderArtists);
$('#artist-grid').addEventListener('click', e => { const b = e.target.closest('.artist'); if (b) openArtist(b.dataset.k); });
let curArtist = null;
function openArtist(key){
  const a = artistList().find(x => x.key === key); if (!a) return;
  curArtist = a;
  const n = a.songs.length, k = Math.min(ARTIST_ROUND, n), p = photoFor(a.name), c = colorFor(a.key);
  const ava = $('#a-ava');
  ava.textContent = p ? '' : (a.name[0] || '?');
  ava.style.background = p ? `url('${p}') center/cover` : c;
  ava.style.color = ['#ffc629', '#ffffff', '#ffe08a', '#8fd0ff', '#6fb1ff'].includes(c) ? 'var(--ink)' : '#fff';
  $('#a-name').textContent = a.name;
  $('#a-count').textContent = plural(n, 'песня', 'песни', 'песен') + ' в игре';
  $('#a-lead').textContent = n > ARTIST_ROUND
    ? `В игре будет ${ARTIST_ROUND} случайных песен из всех треков артиста. Каждый раз — новая десятка.`
    : `В игре будут все ${plural(n, 'песня', 'песни', 'песен')} артиста в случайном порядке.`;
  $('#a-tracks').innerHTML = Array.from({ length: Math.min(5, n) }, (_, i) => `<div class="tr"><i>${i + 1}</i>? ? ?</div>`).join('')
    + (n > 5 ? `<div class="tr" style="justify-content:center">и ещё ${n - 5}…</div>` : '');
  $('#a-play').textContent = `▶ Играть: ${plural(k, 'песня', 'песни', 'песен')}`;
  show('artist');
}
$('#a-play').addEventListener('click', () => startGame('artist'));

/* ====== ИГРА ====== */
const MODES = {
  daily:  { name: 'Песня дня', back: 'home' },
  random: { name: 'Рандом', back: 'solo' },
  artist: { name: 'Артист', back: 'artist' }
};
let G = null;
const MAXLEN = STEPS[STEPS.length - 1];
// шкала «сжатая» (корень), чтобы короткие отрезки 0,5 и 1 с были видны рядом с 15 с
const pos = t => Math.sqrt(Math.max(0, t) / MAXLEN) * 100;

function startGame(mode){
  const pool = library.filter(s => !s.broken);
  if (!pool.length){ toast(isAdmin() ? 'Сначала добавь песни' : 'Песни скоро появятся'); return; }
  let songs;
  if (mode === 'daily') songs = dailySongs();
  else if (mode === 'artist'){ if (!curArtist) return show('artists'); songs = shuffle(curArtist.songs.filter(s => !s.broken)).slice(0, ARTIST_ROUND); }
  else songs = pickDistinct(shuffle(pool.slice()), ROUND_SIZE);
  if (!songs.length){ toast('Нет песен для игры'); return; }
  G = { mode, songs, i: 0, results: [], score: 0 };
  $('#g-mode').textContent = mode === 'artist' ? curArtist.name : MODES[mode].name;
  show('game');
  startSong();
}
function startSong(){
  const song = G.songs[G.i];
  G.cur = { song, step: 0, guesses: [], done: false, solved: false, warm: false };
  selected = null; $('#g-input').value = ''; hideSugg();
  renderGame();
  Snd.load(song, () => { if (G && G.cur && G.cur.song === song){ G.cur.warm = true; renderPlayLabel(); } });
}
Snd.onErr = (code, song) => {
  if (song){ const s = library.find(x => x.id === song.id); if (s && code !== 153) s.broken = true; }
  if (!G || !G.cur || !song || G.cur.song.id !== song.id || G.cur.done) { if ($('#screen-songs').classList.contains('active')){ setMsg('#f-msg', 'Не играет: ' + ytErrorText(code), 'err'); renderSongs(); } return; }
  if (code === 153) return;
  toast(`«${song.title}» не играет (${ytErrorText(code)}) — беру другую`);
  const used = new Set(G.songs.map(s => s.id));
  const from = G.mode === 'artist' && curArtist ? curArtist.songs : library;
  const repl = shuffle(from.filter(s => !s.broken && !used.has(s.id)))[0];
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
  $('#g-score').textContent = G.score;
  $('#g-dots').innerHTML = G.songs.map((_, k) => {
    const r = G.results[k];
    return `<span class="${r ? (r.solved ? 'ok' : 'fail') : (k === G.i ? 'cur' : '')}"></span>`;
  }).join('');
  $('#g-attempts').innerHTML = STEPS.map((len, k) => {
    const g = c.guesses[k];
    if (g){
      const label = g.kind === 'skip' ? 'Пропущено' : esc(g.choice.title + ' — ' + g.choice.artist);
      const tag = g.kind === 'part' ? '<span class="tag">исполнитель ✓</span>' : g.kind === 'bad' ? '<span class="tag">мимо</span>' : g.kind === 'ok' ? '<span class="tag">да!</span>' : '';
      return `<div class="att ${g.kind}"><span class="len">${fmtSec(len)}</span><span class="txt">${label}</span>${tag}</div>`;
    }
    const cur = !c.done && k === c.guesses.length;
    return `<div class="att ${cur ? 'current' : ''}"><span class="len">${fmtSec(len)}</span><span class="txt muted">${cur ? 'Твой ответ…' : ''}</span></div>`;
  }).join('');
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
  const c = G && G.cur; if (!c || c.done) return;
  $('#g-playlabel').textContent = Snd.playing ? 'Играет…' : (!Snd.ready ? 'Загружаю плеер…' : `Слушать ${fmtSec(STEPS[c.step])}`);
  $('#g-playbtn').disabled = !Snd.ready;
}
function setPlaying(on){
  $('#ico-play').style.display = on ? 'none' : '';
  $('#ico-stop').style.display = on ? '' : 'none';
  if (!on) $('#g-prog').style.width = '0';
}
Player.whenReady(() => { if (G && G.cur) renderPlayLabel(); });

$('#g-playbtn').addEventListener('click', () => {
  const c = G && G.cur; if (!c || c.done) return;
  if (Snd.playing){ Snd.stop(); return; }
  setPlaying(true);
  Snd.play(STEPS[c.step], {
    onTick: t => { $('#g-prog').style.width = pos(t) + '%'; },
    onStop: () => { setPlaying(false); renderPlayLabel(); }
  });
  $('#g-playlabel').textContent = 'Играет…';
});

function registerGuess(choice){
  const c = G.cur; if (!c || c.done) return;
  Snd.stop(true);
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
  if (!c.done && kind === 'skip') toast(`Отрывок теперь ${fmtSec(STEPS[c.step])}`);
}
function finishSong(solved){
  const c = G.cur; c.done = true; c.solved = solved;
  const pts = solved ? POINTS[c.guesses.length - 1] : 0;
  G.score += pts;
  G.results.push({ song: c.song, guesses: c.guesses, solved, points: pts });
}
function renderReveal(){
  const c = G.cur, r = G.results[G.results.length - 1];
  const cover = $('#r-cover');
  cover.style.backgroundImage = c.song.yt ? `url(${thumb(c.song.yt).replace('mqdefault', 'hqdefault')})` : '';
  cover.classList.toggle('nocover', !c.song.yt);
  $('#r-title').textContent = c.song.title;
  $('#r-artist').textContent = c.song.artist;
  const v = $('#r-verdict');
  if (c.solved){ v.className = 'verdict ok'; v.textContent = `Угадал с ${c.guesses.length}-й попытки! +${r.points}`; }
  else { v.className = 'verdict fail'; v.textContent = 'Не угадал'; }
  $('#r-link').style.display = c.song.yt ? '' : 'none';
  if (c.song.yt) $('#r-link').href = `https://www.youtube.com/watch?v=${c.song.yt}&t=${Math.floor(c.song.start)}s`;
  $('#r-next').textContent = G.i + 1 >= G.songs.length ? 'Итоги →' : 'Дальше →';
  $('#r-listen').textContent = '▶ Послушать';
}
$('#r-listen').addEventListener('click', () => {
  if (Snd.playing){ Snd.stop(); return; }
  $('#r-listen').textContent = '■ Стоп';
  Snd.play(REVEAL_SEC, { onStop: () => { $('#r-listen').textContent = '▶ Послушать'; } });
});
$('#r-next').addEventListener('click', () => {
  Snd.stop(true);
  G.i++;
  if (G.i >= G.songs.length) showResult(); else startSong();
});
$('#g-skip').addEventListener('click', () => registerGuess(null));
$('#g-answer').addEventListener('click', () => { if (selected) registerGuess(selected); });

// кнопка «Выйти» с подтверждением
$('#g-exit').addEventListener('click', () => $('#exit-modal').classList.add('on'));
$('#exit-stay').addEventListener('click', () => $('#exit-modal').classList.remove('on'));
$('#exit-go').addEventListener('click', () => {
  $('#exit-modal').classList.remove('on');
  const back = G ? MODES[G.mode].back : 'home';
  Snd.stop(true); G = null;
  show(back);
});

/* ====== ПОДСКАЗКИ ПРИ ВВОДЕ ====== */
let selected = null, suggItems = [], hl = -1;
const input = $('#g-input');
function hideSugg(){ $('#g-sugg').classList.remove('show'); suggItems = []; hl = -1; }
function renderSugg(){
  const box = $('#g-sugg');
  const q = norm(input.value);
  if (!q){ hideSugg(); return; }
  const tokens = q.split(' ');
  const guessed = new Set((G && G.cur ? G.cur.guesses : []).filter(g => g.choice).map(g => g.choice.id));
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
const sqFor = g => ({ ok: '🟩', part: '🟧', bad: '🟥', skip: '⬛' }[g.kind]);
function showResult(){
  const max = G.songs.length * POINTS[0];
  const sq = G.results.map(r => r.guesses.map(sqFor).join(''));
  let isBest = false, prevBest = store.get(LS_BEST, null);
  if (G.mode !== 'artist'){ isBest = prevBest == null || G.score > prevBest; if (isBest) store.set(LS_BEST, G.score); }
  if (G.mode === 'daily') store.set(LS_DAILY, { day: dayNumber(), score: G.score, max, sq });
  show('result');
  $('#res-label').textContent = G.mode === 'daily' ? `Песня дня · выпуск №${issueNo()}` : G.mode === 'artist' ? curArtist.name : 'Твой счёт';
  $('#res-total').textContent = G.score;
  $('#res-best').textContent = `из ${max}` + (G.mode !== 'artist' ? (isBest && G.score > 0 ? ' · новый рекорд!' : ` · рекорд: ${Math.max(prevBest ?? 0, G.score)}`) : '');
  $('#res-cd').style.display = G.mode === 'daily' ? '' : 'none';
  $('#res-again').style.display = G.mode === 'daily' ? 'none' : '';
  $('#res-back').textContent = G.mode === 'daily' ? 'На главную' : G.mode === 'artist' ? 'К артисту' : 'К режимам';
  $('#res-list').innerHTML = G.results.map(r => `
    <div class="res-item">
      <div class="t"><div><b>${esc(r.song.title)}</b></div><div class="muted small">${esc(r.song.artist)}</div></div>
      <div class="sq">${r.guesses.map(sqFor).join('')}</div>
      <div class="p" style="color:${r.solved ? 'var(--ok)' : 'var(--muted)'}">${r.points}</div>
    </div>`).join('');
  $('#res-share-text').style.display = 'none';
}
$('#res-again').addEventListener('click', () => startGame(G.mode));
$('#res-back').addEventListener('click', () => show(G ? MODES[G.mode].back : 'home'));
$('#res-share').addEventListener('click', async () => {
  const max = G.songs.length * POINTS[0];
  const head = G.mode === 'daily' ? `Песня дня №${issueNo()}` : G.mode === 'artist' ? curArtist.name : 'Рандом';
  const text = `ЫРЫЛАР · ${head} 🎵 ${G.score}/${max}\n` + G.results.map((r, k) => `${k + 1}. ${r.guesses.map(sqFor).join('')}`).join('\n') + '\n' + location.origin + location.pathname;
  try { await navigator.clipboard.writeText(text); toast('Скопировано — отправь друзьям'); }
  catch(e){ const t = $('#res-share-text'); t.value = text; t.style.display = 'block'; t.select(); toast('Скопируй текст вручную'); }
});

/* ====== ТАЙМЕР ДО НОВЫХ ПЕСЕН ДНЯ ====== */
let lastDay = dayNumber();
setInterval(() => {
  const t = fmtHMS(msToNextDay());
  document.querySelectorAll('.cd-long').forEach(e => e.textContent = t);
  if (dayNumber() !== lastDay){ lastDay = dayNumber(); if (curScreen === 'daily') renderDaily(); }
  if (curScreen === 'home' && booted) renderHome();
}, 1000);

/* ====== ЭКРАН «ПЕСНИ» ====== */
let editingId = null, startTouched = false, mode = 'yt';
let fileBuf = null, fileName = '';            // выбранный mp3 (весь, раскодированный)
function setMsg(sel, text, kind){ const m = $(sel); m.textContent = text || ''; m.className = 'form-msg' + (kind ? ' ' + kind : ''); }
function setMode(m){
  mode = m;
  document.querySelectorAll('#f-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#f-yt-fields').style.display = m === 'yt' ? '' : 'none';
  $('#f-file-fields').style.display = m === 'file' ? '' : 'none';
  $('#f-start-label').textContent = m === 'yt'
    ? 'С какого места начинать (если в начале видео заставка или тишина)'
    : `С какого места вырезать (возьмётся ${CLIP_SEC} секунд отсюда)`;
  setMsg('#f-msg', '');
}
document.querySelectorAll('#f-mode button').forEach(b => b.addEventListener('click', () => { if (!editingId) setMode(b.dataset.mode); }));
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

// выбор mp3: раскодировать и подставить «Исполнитель - Название» из имени файла
$('#f-file').addEventListener('change', async () => {
  const f = $('#f-file').files[0];
  fileBuf = null; fileName = '';
  if (!f){ $('#f-file-info').textContent = ''; return; }
  $('#f-file-info').textContent = 'Читаю файл…';
  try {
    fileBuf = await Clip.decode(await f.arrayBuffer());
    fileName = f.name;
    $('#f-file-info').textContent = `✓ ${f.name} · ${fmtTime(fileBuf.duration)}`;
    const base = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/) || base.match(/^(.+?)[-–—](.+)$/);
    if (!$('#f-artist').value.trim() && m) $('#f-artist').value = m[1].trim();
    if (!$('#f-title').value.trim()) $('#f-title').value = (m ? m[2] : base).trim();
    setMsg('#f-msg', '');
  } catch(e){
    $('#f-file-info').textContent = '';
    setMsg('#f-msg', 'Не получилось прочитать файл. Нужен mp3 (или m4a/ogg/wav).', 'err');
  }
});

$('#f-test').addEventListener('click', () => {
  const f = readForm();
  if (isNaN(f.start)){ setMsg('#f-msg', 'Время начала пиши так: 0:12', 'err'); return; }
  if (Snd.playing){ Snd.stop(); return; }
  const done = () => { $('#f-test').textContent = '▶ Проверить'; if ($('#f-msg').textContent === 'Играет начало…') setMsg('#f-msg', ''); };
  if (mode === 'file'){
    const ed = editingId && library.find(x => x.id === editingId);
    if (ed && ed.file){ setMsg('#f-msg', 'Играет начало…'); $('#f-test').textContent = '■ Стоп'; Snd.preview(ed, { onStop: done }); return; }
    if (!fileBuf){ setMsg('#f-msg', 'Сначала выбери файл', 'err'); return; }
    if (f.start >= fileBuf.duration){ setMsg('#f-msg', 'Время начала дальше конца песни', 'err'); return; }
    Snd.stop(true);
    setMsg('#f-msg', 'Играет начало…'); $('#f-test').textContent = '■ Стоп';
    Clip.playRaw(fileBuf, f.start, PREVIEW_SEC, { onStop: done });
    return;
  }
  if (!f.p){ setMsg('#f-msg', 'Сначала вставь ссылку на YouTube', 'err'); return; }
  setMsg('#f-msg', 'Играет начало…');
  $('#f-test').textContent = '■ Стоп';
  Snd.preview({ id: f.p.id, yt: f.p.id, start: f.start, title: f.title || 'песня' }, { onStop: done });
});

$('#f-save').addEventListener('click', async () => {
  const f = readForm();
  if (!f.artist) return setMsg('#f-msg', 'Напиши исполнителя', 'err');
  if (!f.title) return setMsg('#f-msg', 'Напиши название песни', 'err');
  if (isNaN(f.start)) return setMsg('#f-msg', 'Время начала пиши так: 0:12', 'err');

  if (mode === 'file'){
    // редактирование уже готового отрывка — меняются только подписи
    const ed = editingId && library.find(x => x.id === editingId);
    if (ed && ed.file){
      upsertSong(makeSong({ file: ed.file, artist: f.artist, title: f.title }));
      clearForm(); setMsg('#f-msg', 'Сохранено', 'ok'); renderSongs(); return;
    }
    if (!fileBuf) return setMsg('#f-msg', 'Выбери файл с песней', 'err');
    if (f.start >= fileBuf.duration - 1) return setMsg('#f-msg', 'Время начала дальше конца песни', 'err');
    const same = library.find(s => norm(s.artist) === norm(f.artist) && norm(s.title) === norm(f.title));
    if (same) return setMsg('#f-msg', `Такая песня уже есть: ${same.artist} — ${same.title}`, 'err');
    Snd.stop(true);
    $('#f-save').disabled = true;
    setMsg('#f-msg', 'Вырезаю отрывок…');
    try {
      const { blob } = await encodeClip(fileBuf, f.start, CLIP_SEC);
      const path = clipPathFor(f.artist, f.title);
      await LocalClips.put(path, blob);
      const song = makeSong({ file: path, artist: f.artist, title: f.title });
      upsertSong(song);
      fileStatus.set(path, 'missing');
      clearForm();
      showUpload(path, blob);
      setMsg('#f-msg', `Добавлено: ${song.artist} — ${song.title}`, 'ok');
      renderSongs();
    } catch(e){
      setMsg('#f-msg', e && e.message === 'lame' ? 'Не загрузился кодировщик (lame.min.js) — проверь, что файл есть в репозитории' : 'Не получилось вырезать отрывок', 'err');
    } finally { $('#f-save').disabled = false; }
    return;
  }

  if (!f.p) return setMsg('#f-msg', 'Вставь ссылку на YouTube', 'err');
  const dup = library.find(s => s.id === f.p.id);
  if (dup && dup.id !== editingId) return setMsg('#f-msg', `Эта песня уже есть: ${dup.artist} — ${dup.title}`, 'err');
  if (editingId && editingId !== f.p.id) removeSong(editingId);
  const song = makeSong({ yt: f.p.id, artist: f.artist, title: f.title, start: f.start });
  const added = upsertSong(song);
  clearForm();
  setMsg('#f-msg', added ? `Добавлено: ${song.artist} — ${song.title}` : 'Сохранено', 'ok');
  renderSongs();
});

// после нарезки: скачать отрывок и загрузить его в папку clips на GitHub
function showUpload(path, blob){
  const name = path.split('/').pop();
  const a = $('#up-dl');
  if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
  const url = URL.createObjectURL(blob);
  a.href = url; a.dataset.url = url; a.download = name;
  a.textContent = `⬇ Скачать ${name}`;
  $('#up-size').textContent = `${Math.round(blob.size / 1024)} КБ`;
  const gh = $('#up-gh');
  if (GITHUB_UPLOAD_URL){ gh.href = GITHUB_UPLOAD_URL; gh.style.display = ''; } else gh.style.display = 'none';
  $('#f-upload').style.display = '';
  try { a.click(); } catch(e){}
}
$('#up-close').addEventListener('click', () => { $('#f-upload').style.display = 'none'; });

$('#f-cancel').addEventListener('click', () => { clearForm(); setMsg('#f-msg', ''); });
function clearForm(){
  editingId = null; startTouched = false; fileBuf = null; fileName = '';
  ['#f-url', '#f-artist', '#f-title', '#f-start'].forEach(s => $(s).value = '');
  $('#f-file').value = ''; $('#f-file').style.display = ''; $('#f-file-info').textContent = '';
  $('#f-start').disabled = false;
  $('#f-preview').classList.remove('show');
  $('#f-heading').textContent = 'Добавить песню';
  $('#f-save').textContent = 'Добавить';
  $('#f-cancel').style.display = 'none';
}
function editSong(id){
  const s = library.find(x => x.id === id); if (!s) return;
  clearForm();
  editingId = id; startTouched = true;
  setMode(s.file ? 'file' : 'yt');
  $('#f-artist').value = s.artist; $('#f-title').value = s.title;
  if (s.file){
    $('#f-file').style.display = 'none';
    $('#f-file-info').textContent = `Файл: ${s.file}. Чтобы вырезать другой кусок — удали песню и добавь заново.`;
    $('#f-start').disabled = true;
  } else {
    $('#f-url').value = `https://youtu.be/${s.yt}`;
    $('#f-start').value = s.start ? fmtTime(s.start) : '';
    $('#f-preview').classList.add('show'); $('#f-thumb').src = thumb(s.yt); $('#f-preview-text').textContent = 'Редактирование';
  }
  $('#f-heading').textContent = 'Изменить песню';
  $('#f-save').textContent = 'Сохранить';
  $('#f-cancel').style.display = '';
  setMsg('#f-msg', s.broken ? (s.file ? 'Этот отрывок не играл — проверь, загружен ли файл' : 'Это видео не играло — вставь другую ссылку') : '', s.broken ? 'err' : '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// есть ли файл отрывка на сайте (то есть загружен ли он на GitHub)
const fileStatus = new Map();
function checkFile(path){
  if (fileStatus.has(path)) return;
  fileStatus.set(path, 'checking');
  fetch(path, { method: 'HEAD', cache: 'no-cache' })
    .then(r => fileStatus.set(path, r.ok ? 'ok' : 'missing'))
    .catch(() => fileStatus.set(path, 'missing'))
    .finally(() => { if ($('#screen-songs').classList.contains('active')) renderSongs(); });
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
    .map(s => '  ' + JSON.stringify(s.file ? { file: s.file, artist: s.artist, title: s.title } : { yt: s.yt, artist: s.artist, title: s.title, start: s.start }));
  return '[\n' + rows.join(',\n') + '\n]\n';
}
function renderSongs(){
  const q = norm($('#list-search').value);
  const st = savedState();
  const list = library
    .filter(s => !q || norm(s.artist + ' ' + s.title).includes(q))
    .sort((a, b) => a.artist.localeCompare(b.artist, 'ru') || a.title.localeCompare(b.title, 'ru'));
  $('#list-title').textContent = `Список песен (${library.length})`;
  library.forEach(s => { if (s.file) checkFile(s.file); });
  $('#song-list').innerHTML = list.length ? list.map(s => `
    <div class="song ${s.broken ? 'broken' : ''}" data-id="${esc(s.id)}">
      ${s.yt ? `<img src="${thumb(s.yt)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="ph">♪</div>'}
      <div class="t"><div><b>${esc(s.title)}</b></div><div class="a">${esc(s.artist)}${s.file ? ' · mp3' : ''}${s.start ? ' · с ' + fmtTime(s.start) : ''}</div>${st.unsaved.has(s.id) || (s.file && fileStatus.get(s.file) === 'missing') ? `<div class="badges">${st.unsaved.has(s.id) ? '<span class="badge">не сохранена</span>' : ''}${s.file && fileStatus.get(s.file) === 'missing' ? '<span class="badge bad">нет на GitHub</span>' : ''}</div>` : ''}</div>
      ${s.file && fileStatus.get(s.file) === 'missing' ? '<button class="icon-btn" data-act="dl" title="Скачать отрывок ещё раз">⬇</button>' : ''}
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
  }
  const missing = library.filter(s => s.file && fileStatus.get(s.file) === 'missing').length;
  if (missing) n.innerHTML += `${st.dirty ? '<br>' : ''}Отрывков не загружено в папку <code>clips</code> на GitHub: ${missing}. Нажми ⬇ у песни, скачай файл и загрузи его в <code>clips</code>.`;
  n.style.display = st.dirty || missing ? '' : 'none';
  const gh = $('#gh-link');
  if (GITHUB_EDIT_URL){ gh.href = GITHUB_EDIT_URL; gh.style.display = ''; } else gh.style.display = 'none';
}
$('#list-search').addEventListener('input', renderSongs);
let delArmed = null;
$('#song-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.song').dataset.id;
  const s = library.find(x => x.id === id); if (!s) return;
  if (b.dataset.act === 'dl'){
    LocalClips.get(s.file).then(blob => { if (blob) showUpload(s.file, blob); else toast('Этого отрывка нет в этом браузере — удали песню и добавь файл заново'); });
    return;
  }
  if (b.dataset.act === 'play'){
    if (Snd.playing){ Snd.stop(); return; }
    b.textContent = '■';
    Snd.preview(s, { onStop: () => { b.textContent = '▶'; } });
  } else if (b.dataset.act === 'edit') editSong(id);
  else if (b.dataset.act === 'del'){
    if (delArmed !== id){ delArmed = id; b.textContent = '?'; toast('Нажми ✕ ещё раз, чтобы удалить'); setTimeout(() => { if (delArmed === id){ delArmed = null; b.textContent = '✕'; } }, 3000); return; }
    delArmed = null; removeSong(id); if (s.file) LocalClips.del(s.file); if (editingId === id) clearForm(); renderSongs(); toast('Удалено');
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
    b.innerHTML = '<b>Не загрузился список песен (songs.json).</b> Сайт нужно открывать по ссылке GitHub Pages (ник.github.io/tuvmuzHOM), а не двойным кликом по файлу. Если ссылка правильная — проверь, что в songs.json нет ошибки (лишней запятой или кавычки).';
    b.classList.add('show');
  }
  try { // необязательный файл с фото артистов
    const r = await fetch('artists.json', { cache: 'no-cache' });
    if (r.ok){ const d = await r.json(); if (d && typeof d === 'object') ARTIST_PHOTOS = d; }
  } catch(e){}
  applyAdmin();
  loadLibrary();
  booted = true;
  show('home');
}
Player.init();
boot();
