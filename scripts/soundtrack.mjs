// Original ambient score for the 30-second film, synthesised from scratch
// (no samples, no third-party audio). Cues follow the scene timings in
// video/index.html. Writes output/soundtrack.wav (48 kHz, 16-bit stereo).
//
//   node scripts/soundtrack.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, DUR = 30, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const n = (s) => { const m = s.match(/^([A-G]#?)(-?\d)$/); return 12 * (Number(m[2]) + 1) + NOTE[m[1]]; };
const add = (i, l, r) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };

// ── pad: band-limited detuned saws (additive), slow attack/release ──
const SCENES = [
  { t: 0.0, chord: ['D2', 'A2'], gain: 0.5, bright: 0.25 },
  { t: 2.45, chord: ['D3', 'F#3', 'A3', 'C#4', 'E4'], gain: 0.85, bright: 0.45 },
  { t: 7.0, chord: ['B2', 'D3', 'F#3', 'A3', 'C#4'], gain: 0.75, bright: 0.4 },
  { t: 10.9, chord: ['G2', 'B2', 'D3', 'F#3', 'A3'], gain: 0.75, bright: 0.42 },
  { t: 15.7, chord: ['F#2', 'A2', 'D3', 'E3', 'A3'], gain: 0.75, bright: 0.42 },
  { t: 20.3, chord: ['E2', 'G2', 'B2', 'D3', 'F#3'], gain: 0.75, bright: 0.44 },
  { t: 24.1, chord: ['A2', 'B2', 'E3', 'A3', 'C#4'], gain: 0.8, bright: 0.48 },
  { t: 27.3, chord: ['D2', 'A2', 'E3', 'F#3', 'C#4', 'A4'], gain: 0.95, bright: 0.5 },
];
SCENES.forEach((sc, k) => {
  const t0 = sc.t, t1 = k + 1 < SCENES.length ? SCENES[k + 1].t : DUR;
  const att = k === 0 ? 2.2 : 0.9, rel = 1.4;
  const start = Math.max(0, Math.floor((t0 - 0.15) * SR)), end = Math.min(N, Math.floor((t1 + rel) * SR));
  sc.chord.forEach((name, v) => {
    const f0 = mtof(n(name));
    const pan = 0.5 + (v % 2 ? 0.22 : -0.22) * (v / sc.chord.length + 0.3);
    const voices = [-7, 0, 6].map((c) => f0 * Math.pow(2, c / 1200));
    const phases = voices.map(() => rnd() * Math.PI * 2);
    const H = Math.max(1, Math.min(14, Math.floor(9000 / f0)));
    const amp = (sc.gain * 0.018) / Math.sqrt(sc.chord.length);
    for (let i = start; i < end; i++) {
      const t = i / SR;
      let env = Math.min(1, Math.max(0, (t - t0 + 0.15) / att));
      env = env * env * (3 - 2 * env);
      if (t > t1) env *= Math.max(0, 1 - (t - t1) / rel);
      if (env <= 0) continue;
      const bright = sc.bright * (0.85 + 0.15 * Math.sin(t * 0.7 + v));
      let s = 0;
      for (let w = 0; w < 3; w++) {
        const ph = 2 * Math.PI * voices[w] * t + phases[w];
        for (let h = 1; h <= H; h++) s += (Math.sin(h * ph) / h) * Math.exp(-(h - 1) * (0.92 - bright));
      }
      const val = s * amp * env;
      add(i, val * (1 - pan) * 1.4, val * pan * 1.4);
    }
  });
});

// ── sub drone ──
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const env = Math.min(1, t / 2.5) * (1 - Math.max(0, (t - 28.8) / 1.2));
  const v = (Math.sin(2 * Math.PI * mtof(n('D1')) * t) * 0.05 + Math.sin(2 * Math.PI * mtof(n('D2')) * t) * 0.025) * env;
  add(i, v, v);
}

// ── plucked pulse from the gap scene onward (96 BPM eighths) ──
const pluck = (t0, f, a, pan) => {
  const s = Math.floor(t0 * SR), len = Math.floor(1.2 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.22);
    const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.08)) * env * a;
    add(s + k, v * (1 - pan), v * pan);
  }
};
const EIGHTH = 60 / 96 / 2;
for (let k = 0; k < SCENES.length; k++) {
  const sc = SCENES[k];
  if (sc.t < 7.0 || sc.t >= 27.3) continue;
  const t1 = SCENES[k + 1].t;
  const tones = sc.chord.slice(1).map((x) => n(x) + 12);
  const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
  let step = 0;
  for (let t = sc.t; t < t1 - 0.05; t += EIGHTH, step++) {
    const m = tones[pattern[step % pattern.length] % tones.length];
    const accent = step % 4 === 0 ? 1 : 0.7;
    const fadeIn = sc.t === 7.0 ? Math.min(1, (t - 7.0) / 1.2) : 1;
    pluck(t, mtof(m), 0.065 * accent * fadeIn, step % 2 ? 0.62 : 0.38);
  }
}

// ── constellation twinkles (opening) and closing sparkle ──
const bell = (t0, f, a, pan) => {
  const s = Math.floor(t0 * SR), len = Math.floor(2.2 * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.55);
    const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / 0.15)) * env * a;
    add(s + k, v * (1 - pan), v * pan);
  }
};
const PENTA = ['D6', 'E6', 'F#6', 'A6', 'B6', 'D7'].map(n);
for (let k = 0; k < 16; k++) bell(0.25 + k * 0.13 + rnd() * 0.06, mtof(PENTA[Math.floor(rnd() * PENTA.length)]), 0.018, 0.2 + rnd() * 0.6);
for (let k = 0; k < 7; k++) bell(27.5 + k * 0.17, mtof(PENTA[(k * 2) % PENTA.length]), 0.016, 0.25 + (k % 3) * 0.25);

// ── whooshes (filtered noise) at transitions ──
const whoosh = (tc, dur, f0, f1, a) => {
  const s = Math.floor((tc - dur * 0.7) * SR), len = Math.floor(dur * SR);
  let lp = 0, bp = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len;
    const f = f0 * Math.pow(f1 / f0, u);
    const F = 2 * Math.sin(Math.PI * f / SR), Q = 0.35;
    const x = rnd() * 2 - 1;
    const hp = x - lp - Q * bp;
    bp += F * hp; lp += F * bp;
    const env = Math.sin(Math.PI * Math.min(1, u / 0.7) * 0.5) ** 2 * (u < 0.7 ? 1 : Math.max(0, 1 - (u - 0.7) / 0.3));
    const v = bp * env * a;
    add(s + k, v * (0.5 + 0.4 * (u - 0.5)), v * (0.5 - 0.4 * (u - 0.5)));
  }
};
whoosh(2.45, 1.9, 200, 5200, 0.10);   // riser into the title
whoosh(3.6, 1.2, 600, 2400, 0.045);   // drones appear
[7.0, 10.9, 15.7, 20.3, 24.1].forEach((t) => whoosh(t, 0.7, 500, 3500, 0.05));
whoosh(27.3, 1.4, 250, 4200, 0.07);

// ── impacts ──
const boom = (t0, a) => {
  const s = Math.floor(t0 * SR), len = Math.floor(3 * SR);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const f = mtof(n('D1')) + 64 * Math.exp(-t * 7);   // settles on the drone's pitch: no beating
    ph += 2 * Math.PI * f / SR;
    const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.75);
    const v = Math.sin(ph) * env * a;
    add(s + k, v, v);
  }
};
boom(2.45, 0.26);
boom(27.3, 0.2);

// ── reverb (Freeverb-style) ──
function reverb(inp, combs, aps, damp = 0.35, fb = 0.84) {
  const out = new Float32Array(N);
  for (const d of combs) {
    const buf = new Float32Array(d); let idx = 0, store = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[idx];
      store = y * (1 - damp) + store * damp;
      buf[idx] = inp[i] + store * fb;
      out[i] += y;
      idx = (idx + 1) % d;
    }
  }
  for (const d of aps) {
    const buf = new Float32Array(d); let idx = 0;
    for (let i = 0; i < N; i++) {
      const b = buf[idx];
      const y = -out[i] + b;
      buf[idx] = out[i] + b * 0.5;
      out[i] = y;
      idx = (idx + 1) % d;
    }
  }
  return out;
}
const sc = SR / 44100;
const CL = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * sc));
const AP = [556, 441, 341, 225].map((d) => Math.round(d * sc));
const wetL = reverb(L, CL, AP), wetR = reverb(R, CL.map((d) => d + 23), AP.map((d) => d + 23));

// ── mix, tone, fade, normalise ──
const outL = new Float32Array(N), outR = new Float32Array(N);
let lpL = 0, lpR = 0, peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let l = L[i] * 0.78 + wetL[i] * 0.05;
  let r = R[i] * 0.78 + wetR[i] * 0.05;
  lpL += 0.55 * (l - lpL); lpR += 0.55 * (r - lpR);
  const fade = Math.min(1, t / 0.05) * Math.min(1, (DUR - t) / 0.8);
  outL[i] = Math.tanh(lpL * 1.6) * fade;
  outR[i] = Math.tanh(lpR * 1.6) * fade;
  peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
}
const gain = 0.85 / peak;  // about -1.4 dBFS peak, roughly -18.5 LUFS integrated
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outL[i] * gain)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outR[i] * gain)) * 32767), 46 + i * 4);
}
const out = resolve(ROOT, 'output/soundtrack.wav');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, buf);
console.log(`wrote ${out}`);
