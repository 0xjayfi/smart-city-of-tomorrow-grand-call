// Builds a self-contained, shareable web version of the film into dist/web/:
// one HTML page (inline CSS + one inline module), three.js from jsDelivr,
// fonts from Google Fonts, and the soundtrack beside it.
//
//   node scripts/build-web.mjs

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'dist/web');
const THREE = '0.170.0';
const read = (p) => readFile(resolve(ROOT, p), 'utf8');

const html = await read('video/index.html');
const css = (await read('video/styles.css')).replace(/@font-face\s*\{[^}]*\}\s*/g, '');

// Concatenate the modules in dependency order; keep only the three.js imports.
const threeImports = new Set();
const strip = (src) => src
  .replace(/^import[^;]*from\s+'(three[^']*)';\s*$/gm, (line) => { threeImports.add(line.trim()); return ''; })
  .replace(/^import[^;]*from\s+'\.\/[^']*';\s*$/gm, '')
  .replace(/^export\s+(?=(const|function|class|let)\b)/gm, '');
const parts = [];
for (const f of ['util.js', 'city.js', 'overlay.js', 'main.js']) parts.push(`// ── ${f}\n${strip(await read(`video/js/${f}`))}`);
const js = [...threeImports].join('\n') + '\n\n' + parts.join('\n');

const body = html.slice(html.indexOf('<div id="viewport">'), html.indexOf('<script type="module"')).trim();
const page = `<title>Smart Cities of Tomorrow</title>
<meta name="description" content="A 30-second film of the A*STAR/RGC joint proposal: AI residents for transport policy evaluation in Hong Kong and Singapore.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,500&family=Instrument+Serif:ital@0;1&display=block">
<style>
${css.replace(':root {', ':root {\n  color-scheme: dark;')}
</style>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@${THREE}/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE}/examples/jsm/"
} }
</script>
${body}
<script>window.SOUNDTRACK_URL = './soundtrack.mp3';</script>
<script type="module">
${js}
</script>
`;

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'index.html'), page);
await copyFile(resolve(ROOT, 'output/soundtrack.mp3'), resolve(OUT, 'soundtrack.mp3'));
console.log(`wrote ${OUT}/index.html (${(page.length / 1024).toFixed(0)} KB) and soundtrack.mp3`);
