// Boot: load fonts, build the city and overlay, expose renderAt(t) for
// frame capture, and (in a normal browser) run an interactive player.

import { City } from './city.js';
import { Overlay, CHAPTERS } from './overlay.js';
import { clamp } from './util.js';

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const DURATION = 30;
const POSTER_T = 6.45;  // still shown before the viewer presses play
const SOUNDTRACK_URL = window.SOUNDTRACK_URL ?? '../output/soundtrack.mp3';
document.documentElement.classList.toggle('render', RENDER);

const stage = document.getElementById('stage');
const FONTS = [
  '400 20px "Instrument Sans"', '500 20px "Instrument Sans"', '600 20px "Instrument Sans"', 'italic 500 20px "Instrument Sans"',
  '400 20px "Instrument Serif"', 'italic 400 20px "Instrument Serif"', '400 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"',
];
await Promise.all(FONTS.map((f) => document.fonts.load(f)));
await document.fonts.ready;

const city = new City(document.getElementById('city'), { width: 1920, height: 1080, pixelRatio: 1 });
const overlay = new Overlay(stage, { interactive: !RENDER });

function renderAt(t) {
  t = clamp(t, 0, DURATION);
  city.render(t);
  overlay.update(t);
}
window.renderAt = renderAt;
window.DURATION = DURATION;
renderAt(RENDER ? 0 : POSTER_T);
window.__ready = true;

if (!RENDER) startPlayer();

function startPlayer() {
  const controls = document.getElementById('controls');
  const playBtn = document.getElementById('play');
  const soundBtn = document.getElementById('sound');
  const bigPlay = document.getElementById('bigplay');
  const scrub = document.getElementById('scrub');
  const clock = document.getElementById('clock');
  const chapters = document.getElementById('chapters');
  controls.hidden = false;

  const fit = () => {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.position = 'absolute';
    stage.style.left = '50%';
    stage.style.top = '50%';
    stage.style.transform = `translate(-50%, -50%) scale(${k})`;
  };
  fit();
  addEventListener('resize', fit);

  const deepLink = params.has('t');
  let t = deepLink ? clamp(Number(params.get('t')) || 0, 0, DURATION) : POSTER_T;
  let playing = false;
  let atPoster = !deepLink;
  bigPlay.hidden = !atPoster;
  let last = performance.now();
  let idleTimer = 0;

  // ── optional soundtrack, synced to the film clock ──
  const audio = { ctx: null, buf: null, src: null, on: false, t0: 0, loading: null };
  const loadAudio = () => audio.loading ??= (async () => {
    audio.ctx = new AudioContext();
    const res = await fetch(SOUNDTRACK_URL);
    audio.buf = await audio.ctx.decodeAudioData(await res.arrayBuffer());
  })();
  const stopAudio = () => { try { audio.src?.stop(); } catch { /* already stopped */ } audio.src = null; };
  const syncAudio = () => {
    stopAudio();
    if (!audio.on || !audio.buf || !playing || t >= DURATION) return;
    const s = audio.ctx.createBufferSource();
    s.buffer = audio.buf;
    s.connect(audio.ctx.destination);
    s.start(0, t);
    audio.src = s;
    audio.t0 = audio.ctx.currentTime - t;
  };
  soundBtn.addEventListener('click', async () => {
    audio.on = !audio.on;
    soundBtn.setAttribute('aria-pressed', String(audio.on));
    soundBtn.setAttribute('aria-label', audio.on ? 'Turn sound off' : 'Turn sound on');
    controls.classList.toggle('sound-on', audio.on);
    if (audio.on) {
      try { await loadAudio(); await audio.ctx.resume(); } catch { audio.on = false; controls.classList.remove('sound-on'); return; }
    }
    syncAudio();
  });

  const seek = (to, play = playing) => {
    t = clamp(to, 0, DURATION);
    atPoster = false;
    bigPlay.hidden = true;
    playing = play;
    syncAudio();
  };
  const toggle = () => {
    if (atPoster || (!playing && t >= DURATION)) return seek(0, true);
    seek(t, !playing);
  };

  const chapterBtns = CHAPTERS.map(([name, at]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => seek(at, true));
    chapters.appendChild(b);
    return { b, at };
  });

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  bigPlay.addEventListener('click', toggle);
  playBtn.addEventListener('click', toggle);
  stage.addEventListener('click', (e) => { if (!e.target.closest('.tip-target')) toggle(); });
  scrub.addEventListener('input', () => seek(Number(scrub.value), false));
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.code === 'ArrowRight') seek(t + 2);
    if (e.code === 'ArrowLeft') seek(t - 2);
  });
  addEventListener('pointermove', () => {
    controls.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (playing) controls.classList.add('idle'); }, 2500);
  });

  let drawnT = -1;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      t = audio.src ? audio.ctx.currentTime - audio.t0 : t + dt;
      if (t >= DURATION) { t = DURATION; playing = false; stopAudio(); }
    }
    // the city is a pure function of t: redraw WebGL only when t moves
    if (t !== drawnT) { city.render(t); drawnT = t; }
    overlay.update(t);
    scrub.value = t.toFixed(2);
    clock.textContent = `${fmt(t)} / ${fmt(DURATION)}`;
    controls.classList.toggle('paused', !playing);
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    let active = 0;
    chapterBtns.forEach((c, i) => { if (t >= c.at) active = i; });
    chapterBtns.forEach((c, i) => c.b.classList.toggle('on', i === active && !atPoster));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
