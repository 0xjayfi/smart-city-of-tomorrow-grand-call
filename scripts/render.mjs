// Frame-accurate capture of video/index.html → PNG frames → MP4.
//
//   node scripts/render.mjs                       full film → output/*.mp4
//   node scripts/render.mjs --stills 0,3.5,12     a few stills → output/stills/
//   node scripts/render.mjs --fps 30 --workers 2 --from 0 --to 30
//
// The page exposes window.renderAt(t); each frame is rendered on demand, so
// capture speed never affects timing.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

const FPS = Number(args.fps ?? 30);
const WORKERS = Number(args.workers ?? 2);
const PAGE = args.page ?? 'video/index.html';
const OUT = resolve(ROOT, args.out ?? 'output/smart-city-of-tomorrow-30s.mp4');
const FRAMES = resolve(ROOT, args.frames ?? '.frames');
const AUDIO = args.audio === 'none' ? null : resolve(ROOT, args.audio ?? 'output/soundtrack.wav');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((ok) => {
    const srv = createServer(async (req, res) => {
      try {
        const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!p.startsWith(ROOT)) throw new Error('outside root');
        const body = await readFile(p);
        res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end();
      }
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[console]', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/${PAGE}?render=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page;
}

async function shoot(page, t, file) {
  await page.evaluate((tt) => window.renderAt(tt), t);
  await page.screenshot({ path: file, type: 'png', animations: 'disabled', caret: 'initial' });
}

const run = (cmd, argv) => new Promise((ok, fail) => {
  const p = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`${cmd} exited ${c}`))));
});

const srv = await serve();
const port = srv.address().port;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'],
});

try {
  if (args.stills) {
    const dir = resolve(ROOT, args.stillsDir ?? 'output/stills');
    await mkdir(dir, { recursive: true });
    const page = await openPage(browser, port);
    for (const s of String(args.stills).split(',')) {
      const t = Number(s);
      const file = join(dir, `t${t.toFixed(2).padStart(5, '0')}.png`);
      const t0 = Date.now();
      await shoot(page, t, file);
      console.log(`still t=${t}s → ${file} (${Date.now() - t0} ms)`);
    }
  } else {
    const from = Number(args.from ?? 0), to = Number(args.to ?? 30);
    const total = Math.round((to - from) * FPS);
    await rm(FRAMES, { recursive: true, force: true });
    await mkdir(FRAMES, { recursive: true });
    const pages = await Promise.all(Array.from({ length: WORKERS }, () => openPage(browser, port)));
    let done = 0;
    const started = Date.now();
    await Promise.all(pages.map(async (page, w) => {
      for (let i = w; i < total; i += WORKERS) {
        await shoot(page, from + i / FPS, join(FRAMES, `f${String(i).padStart(5, '0')}.png`));
        done++;
        if (done % 30 === 0) {
          const el = (Date.now() - started) / 1000;
          console.log(`${done}/${total} frames · ${el.toFixed(0)}s elapsed · ~${((total - done) * el / done).toFixed(0)}s left`);
        }
      }
    }));
    await mkdir(dirname(OUT), { recursive: true });
    let hasAudio = false;
    if (AUDIO) { try { await stat(AUDIO); hasAudio = true; } catch { console.warn('no soundtrack found, rendering silent'); } }
    const ff = ['-y', '-framerate', String(FPS), '-i', join(FRAMES, 'f%05d.png')];
    if (hasAudio) ff.push('-i', AUDIO);
    ff.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf ?? 18), '-pix_fmt', 'yuv420p',
      '-profile:v', 'high', '-tune', 'animation', '-movflags', '+faststart');
    if (hasAudio) ff.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    ff.push(OUT);
    await run('ffmpeg', ff);
    console.log(`wrote ${OUT}`);
  }
} finally {
  await browser.close();
  srv.close();
}
