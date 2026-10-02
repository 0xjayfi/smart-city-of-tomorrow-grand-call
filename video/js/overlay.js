// Text, charts and diagrams layered over the city. Every element is driven
// by renderAt(t): entrance/exit timings come from data-in / data-out
// attributes in index.html, charts from the update functions below.

import { clamp, lerp, smooth, easeOutCubic, easeInOutCubic, easeOutBack, prog, envelope, hash1, fmtInt } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const C = {
  accent: '#F2B33D', amber: '#C2860E', cyan: '#2799BD', slate: '#3A4B70',
  line: '#2A3B5E', line2: '#3A4B70', grid: '#1D2B46', ink: '#F4EFE6', muted: '#AEB9CB',
  soft: '#D5DCE8', foot: '#8E9BB0', bg: '#0C1626', grey: '#8E9BB0',
};

function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function text(parent, x, y, str, attrs = {}) {
  const t = svg('text', { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}
const show = (node, a) => { node.style.opacity = a; };
const tipAttrs = (title, body, src = '') => ({ class: 'tip-target', 'data-tip-title': title, 'data-tip-body': body, 'data-tip-src': src });

export const CHAPTERS = [
  ['Opening', 0], ['The gap', 7.0], ['Approach', 10.9], ['Why now', 15.7],
  ['Commitment', 20.3], ['Benefits', 24.1], ['Request', 27.3],
];

export class Overlay {
  constructor(stage, { interactive = false } = {}) {
    this.stage = stage;
    this.interactive = interactive;
    this.scenes = [...stage.querySelectorAll('.scene')].map((el) => ({ el, start: +el.dataset.start, end: +el.dataset.end }));
    this.splitWords();
    this.items = [...stage.querySelectorAll('[data-in]')].map((n) => this.register(n)).filter(Boolean);
    this.counters = [...stage.querySelectorAll('[data-count]')].map((n) => ({
      node: n, to: +n.dataset.count, prefix: n.dataset.prefix ?? '', suffix: n.dataset.suffix ?? '', tin: +n.dataset.cin,
    }));
    this.railDots = [...stage.querySelectorAll('.rail-dot')];
    this.railNames = [...stage.querySelectorAll('.rail-name')];
    this.q = (s) => stage.querySelector(s);
    this.updaters = [
      this.buildSim(this.q('#sim-rule'), false),
      this.buildSim(this.q('#sim-ai'), true),
      this.buildLoop(this.q('#loop')),
      this.buildGantt(this.q('#gantt')),
      this.buildMeter(this.q('#meter')),
      this.buildFund(this.q('#fund-sg'), 21.15, [
        { v: 150000, label: 'Phase 1 · up to S$150,000', tip: ['Singapore side · Phase 1', 'Up to S$150,000 over 24 months from August 2027, held by the PI’s institute (CFAR).', 'Joint Call Guidelines 2026; proposal Section 3'] },
        { v: 300000, label: 'Phase 2 · up to S$300,000', tip: ['Singapore side · Phase 2', 'Up to S$300,000 if the project is among the up to 3 of 10 selected for Phase 2.', 'Joint Call Guidelines 2026'] },
      ]),
      this.buildFund(this.q('#fund-hk'), 21.4, [
        { v: 983280, label: 'Phase 1 · HK$983,280', tip: ['Hong Kong side · Phase 1', 'HK$983,280 requested. Funds one PhD student and one post-doctoral fellow.', 'Proposal Section 3 Project Funding'], id: 'hk-p1' },
        { v: 1787280, label: 'Phase 2 · HK$1,787,280', tip: ['Hong Kong side · Phase 2', 'HK$1,787,280 requested for months 25 to 60, if selected.', 'Proposal Section 3 Project Funding'] },
      ]),
      this.buildYears(this.q('#years')),
    ];

    // tooltip + demo cursor
    this.tip = this.q('#tooltip');
    this.tipTitle = this.tip.querySelector('.tt-title');
    this.tipBody = this.tip.querySelector('.tt-body');
    this.tipSrc = this.tip.querySelector('.tt-src');
    this.cursor = this.q('#cursor');
    this.ripple = this.q('#ripple');
    this.guided = [
      { target: this.q('#gantt [data-key="waymo"]'), point: this.q('#gantt [data-key="waymo"] rect'), t0: 17.7, arrive: 18.3, t1: 20.05 },
    ];
    this.hover = null;
    if (interactive) {
      stage.querySelectorAll('.tip-target').forEach((n) => {
        n.addEventListener('pointerenter', () => { this.hover = n; });
        n.addEventListener('pointerleave', () => { if (this.hover === n) this.hover = null; });
      });
    }
  }

  // ─────────────────────────────────────────── generic timed items
  splitWords() {
    this.stage.querySelectorAll('[data-fx="words"]').forEach((el) => {
      const tin = +el.dataset.in, stagger = +(el.dataset.stagger ?? 0.06), out = el.dataset.out;
      let i = 0;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((tn) => {
        const frag = document.createDocumentFragment();
        tn.textContent.split(/(\s+)/).forEach((tok) => {
          if (!tok) return;
          if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
          const w = document.createElement('span');
          w.className = 'w';
          w.textContent = tok;
          w.dataset.in = (tin + i++ * stagger).toFixed(3);
          w.dataset.fx = 'word';
          if (out) w.dataset.out = out;
          frag.appendChild(w);
        });
        tn.replaceWith(frag);
      });
      el.dataset.fx = 'none';
    });
  }

  register(node) {
    const fx = node.dataset.fx || 'up';
    if (fx === 'none') return null;
    const scene = node.closest('.scene');
    const end = scene ? +scene.dataset.end : 1e9;
    return {
      node, fx, scene,
      tin: +node.dataset.in,
      dur: +(node.dataset.dur ?? (fx === 'word' ? 0.5 : 0.6)),
      tout: node.dataset.out ? +node.dataset.out : end - 0.4,
      odur: 0.35,
      dist: fx === 'word' ? 22 : 26,
      text: fx === 'type' ? node.textContent : null,
    };
  }

  applyItem(it, t) {
    const a = clamp((t - it.tin) / it.dur);
    const o = clamp((t - it.tout) / it.odur);
    const n = it.node;
    if (it.fx === 'type') {
      const len = it.text.length;
      const k = Math.round(len * a);
      if (k !== it.k) {
        if (!it.spans) {
          n.textContent = '';
          it.spans = [document.createElement('span'), document.createElement('span')];
          it.spans[1].style.opacity = 0;
          n.append(...it.spans);
        }
        it.spans[0].textContent = it.text.slice(0, k);
        it.spans[1].textContent = it.text.slice(k);
        it.k = k;
      }
      n.style.opacity = (a > 0 ? 1 : 0) * (1 - smooth(o));
      return;
    }
    const e = easeOutCubic(a);
    const fo = smooth(o);
    n.style.opacity = (it.fx === 'fade' ? smooth(a) : e) * (1 - fo);
    if (it.fx !== 'fade') n.style.transform = `translate3d(0, ${((1 - e) * it.dist - fo * 10).toFixed(2)}px, 0)`;
  }

  // ─────────────────────────────────────────── 1 · mini simulations
  buildSim(root, ai) {
    const O = { x: 150, y: 124 }, D = { x: 700, y: 124 };
    const routeA = svg('path', { d: `M${O.x},${O.y} C 290,14 560,14 ${D.x},${D.y}`, fill: 'none', stroke: C.line2, 'stroke-width': 3, 'stroke-linecap': 'round' }, root);
    const routeB = svg('path', { d: `M${O.x},${O.y} C 290,234 560,234 ${D.x},${D.y}`, fill: 'none', stroke: ai ? C.accent : C.line2, 'stroke-opacity': ai ? 0.55 : 1, 'stroke-width': 3, 'stroke-linecap': 'round' }, root);
    const LA = routeA.getTotalLength(), LB = routeB.getTotalLength();
    routeB.setAttribute('stroke-dasharray', `${LB} ${LB}`);
    text(root, 425, 26, 'Bus + walk', { 'text-anchor': 'middle', fill: C.muted, 'font-size': 16, 'font-family': 'IBM Plex Mono', 'letter-spacing': '0.06em' });
    const bLabel = svg('g', {}, root);
    const badge = svg('rect', { x: 337, y: 222, width: 176, height: 28, rx: 6, fill: '#0C1626', stroke: ai ? C.accent : C.line2 }, bLabel);
    text(bLabel, 425, 241, 'New: robotaxi service', { 'text-anchor': 'middle', fill: ai ? C.accent : C.muted, 'font-size': 14, 'font-family': 'IBM Plex Mono' });
    void badge;
    // origin / destination
    const node = (p, label) => {
      svg('circle', { cx: p.x, cy: p.y, r: 11, fill: '#0C1626', stroke: C.soft, 'stroke-width': 2.5 }, root);
      text(root, p.x, p.y + 38, label, { 'text-anchor': 'middle', fill: C.foot, 'font-size': 13, 'font-family': 'IBM Plex Mono', 'letter-spacing': '0.1em' });
    };
    node(O, 'ORIGIN'); node(D, 'DESTINATION');
    // reasoning pulse (AI) / rule lock (conventional)
    const rings = ai ? [0, 1].map(() => svg('circle', { cx: O.x, cy: O.y, r: 12, fill: 'none', stroke: C.accent, 'stroke-width': 2 }, root)) : [];
    const note = text(root, O.x - 26, O.y + 5, ai ? 'reasoning…' : 'rule: bus', {
      'text-anchor': 'end', fill: ai ? C.accent : C.foot, 'font-size': 15, 'font-family': 'IBM Plex Mono',
    });
    const N = 24, T0 = 7.15, GAP = 0.155, TRAVEL = 1.5, TB = 8.05;
    const dots = Array.from({ length: N }, (_, i) => {
      const spawn = T0 + i * GAP;
      const useB = ai && spawn > TB + 0.3 && hash1(i * 7 + 3) < 0.5;
      const c = svg('circle', { r: 7.5, fill: ai ? C.accent : C.grey, stroke: '#14213A', 'stroke-width': 2 }, root);
      return { c, spawn, path: useB ? routeB : routeA, L: useB ? LB : LA };
    });
    return (t) => {
      if (t < 7.0 || t > 11) return;
      const b = easeInOutCubic(prog(t, TB, 0.55));
      routeB.setAttribute('stroke-dashoffset', (LB * (1 - b)).toFixed(1));
      show(bLabel, smooth(prog(t, TB + 0.25, 0.3)));
      show(note, smooth(prog(t, ai ? TB + 0.2 : 7.5, 0.3)));
      rings.forEach((r, k) => {
        const ph = ((t - TB - 0.15 - k * 0.35) / 0.7) % 1;
        const on = t > TB + 0.15 + k * 0.35 ? 1 : 0;
        r.setAttribute('r', (12 + 18 * ph).toFixed(1));
        r.style.opacity = on * (1 - ph) * 0.8;
      });
      dots.forEach((d) => {
        const p = (t - d.spawn) / TRAVEL;
        if (p < 0 || p > 1) { d.c.style.opacity = 0; return; }
        const pt = d.path.getPointAtLength(p * d.L);
        d.c.setAttribute('cx', pt.x.toFixed(1));
        d.c.setAttribute('cy', pt.y.toFixed(1));
        d.c.style.opacity = clamp(p / 0.06) * clamp((1 - p) / 0.06);
      });
    };
  }

  // ─────────────────────────────────────────── 2 · calibration loop
  buildLoop(root) {
    const mono = { 'font-family': 'IBM Plex Mono' };
    const chip = (x, y, w, h, title, sub, accent = false) => {
      const g = svg('g', {}, root);
      svg('rect', { x, y, width: w, height: h, rx: 8, fill: '#0F1A2E', stroke: accent ? C.accent : C.line2, 'stroke-width': 1.5 }, g);
      text(g, x + 18, y + 36, title, { fill: C.ink, 'font-size': 20, 'font-weight': 600 });
      text(g, x + 18, y + 62, sub, { fill: C.muted, 'font-size': 14, ...mono, 'letter-spacing': '0.08em' });
      return g;
    };
    const hk = chip(14, 44, 262, 84, 'HKSim', 'HONG KONG');
    const sg = chip(14, 166, 262, 84, 'Island-wide simulator', 'SINGAPORE');
    // AI residents drifting inside the simulators
    const res = [];
    [[14, 44], [14, 166]].forEach(([x, y], k) => {
      for (let i = 0; i < 5; i++) res.push({ c: svg('circle', { r: 4, fill: C.accent }, root), x, y, i, k });
    });
    const CX = 535, CY = 150, R = 100;
    const flows = [
      svg('path', { d: `M276,86 C350,86 370,${CY} ${CX - R - 4},${CY}`, fill: 'none', stroke: C.muted, 'stroke-width': 2, 'stroke-dasharray': '4 9', 'stroke-linecap': 'round' }, root),
      svg('path', { d: `M276,208 C350,208 370,${CY} ${CX - R - 4},${CY}`, fill: 'none', stroke: C.muted, 'stroke-width': 2, 'stroke-dasharray': '4 9', 'stroke-linecap': 'round' }, root),
    ];
    svg('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: C.line2, 'stroke-width': 2 }, root);
    const arc = svg('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: C.accent, 'stroke-width': 3, 'stroke-linecap': 'round', transform: `rotate(-90 ${CX} ${CY})` }, root);
    const circ = 2 * Math.PI * R;
    arc.setAttribute('stroke-dasharray', `${circ} ${circ}`);
    text(root, CX, CY - 4, 'Calibration', { 'text-anchor': 'middle', fill: C.soft, 'font-size': 18, 'font-weight': 600 });
    text(root, CX, CY + 20, 'agents', { 'text-anchor': 'middle', fill: C.soft, 'font-size': 18, 'font-weight': 600 });
    const nodesDef = [
      { a: -Math.PI / 2, label: 'Diagnose discrepancies', lx: CX, ly: CY - R - 18, anchor: 'middle' },
      { a: Math.PI / 6, label: 'Targeted alignment', lx: CX + 92, ly: CY + R + 24, anchor: 'middle' },
      { a: (5 * Math.PI) / 6, label: 'Re-evaluate', lx: CX - 92, ly: CY + R + 24, anchor: 'middle' },
    ];
    const nodes = nodesDef.map((d) => {
      const x = CX + R * Math.cos(d.a), y = CY + R * Math.sin(d.a);
      const halo = svg('circle', { cx: x, cy: y, r: 10, fill: C.accent, opacity: 0 }, root);
      const dot = svg('circle', { cx: x, cy: y, r: 9, fill: '#0F1A2E', stroke: C.accent, 'stroke-width': 2.5 }, root);
      text(root, d.lx, d.ly, d.label, { 'text-anchor': d.anchor, fill: C.ink, 'font-size': 17, 'font-weight': 500 });
      return { ...d, halo, dot };
    });
    // output
    svg('path', { d: `M${CX + R + 6},${CY} L${CX + R + 40},${CY}`, stroke: C.muted, 'stroke-width': 2 }, root);
    svg('path', { d: `M${CX + R + 40},${CY - 6} L${CX + R + 50},${CY} L${CX + R + 40},${CY + 6} Z`, fill: C.muted }, root);
    const out = chip(688, 108, 186, 84, 'Policy evaluation', 'ROBOTAXI · UAV', true);
    // trail
    const comet = Array.from({ length: 12 }, (_, k) => svg('circle', { r: 6.5 * (1 - k / 14), fill: k === 0 ? '#FFE1A0' : C.accent }, root));
    // framework rail
    const steps = ['Model', 'Self-improve', 'Validate', 'Generalize'];
    const RY = 336, xs = [40, 300, 560, 820];
    svg('line', { x1: xs[0], y1: RY, x2: xs[3], y2: RY, stroke: C.line2, 'stroke-width': 2 }, root);
    const fill = svg('line', { x1: xs[0], y1: RY, x2: xs[0], y2: RY, stroke: C.accent, 'stroke-width': 2 }, root);
    const sdots = steps.map((s, i) => {
      const d = svg('circle', { cx: xs[i], cy: RY, r: 7, fill: '#0F1A2E', stroke: C.line2, 'stroke-width': 2 }, root);
      const l = text(root, xs[i], RY + 34, s.toUpperCase(), {
        'text-anchor': i === 0 ? 'start' : i === 3 ? 'end' : 'middle', fill: C.muted, 'font-size': 15, ...mono, 'letter-spacing': '0.12em',
      });
      if (i === 0) l.setAttribute('x', xs[0] - 7);
      if (i === 3) l.setAttribute('x', xs[3] + 7);
      return { d, l };
    });
    const T = [11.75, 12.2, 12.65, 13.1];
    return (t) => {
      if (t < 10.8 || t > 15.8) return;
      res.forEach((r) => {
        const sp = 0.18 + 0.05 * r.i;
        const u = (hash1(r.i * 13 + r.k * 5) + t * sp) % 1;
        r.c.setAttribute('cx', (r.x + 150 + u * 96).toFixed(1));
        r.c.setAttribute('cy', (r.y + 50 + 22 * hash1(r.i * 3 + r.k)).toFixed(1));
        r.c.style.opacity = Math.sin(u * Math.PI) * 0.95;
      });
      flows.forEach((f) => f.setAttribute('stroke-dashoffset', (-t * 34).toFixed(1)));
      const st = 11.7;
      const th = -Math.PI / 2 + Math.max(0, t - st) * 2.5;
      const sweep = clamp((t - st) * 2.5 / (2 * Math.PI));
      arc.setAttribute('stroke-dashoffset', (circ * (1 - sweep)).toFixed(1));
      arc.style.opacity = 0.25 + 0.35 * (sweep >= 1 ? 1 : 0) + (sweep < 1 ? 0.4 : 0);
      comet.forEach((c, k) => {
        const a = th - k * 0.065;
        c.setAttribute('cx', (CX + R * Math.cos(a)).toFixed(1));
        c.setAttribute('cy', (CY + R * Math.sin(a)).toFixed(1));
        c.style.opacity = (t > st ? 1 : 0) * (1 - k / 12) * 0.95;
      });
      nodes.forEach((n) => {
        let d = (th - n.a) % (2 * Math.PI);
        if (d < 0) d += 2 * Math.PI;
        const g = t > st && th >= n.a - 0.01 ? clamp(1 - d / 1.1) : 0;
        n.halo.setAttribute('r', (10 + 12 * g).toFixed(1));
        n.halo.style.opacity = 0.45 * g;
        n.dot.setAttribute('fill', g > 0.2 ? C.accent : '#0F1A2E');
      });
      let fx = xs[0];
      for (let i = 1; i < 4; i++) {
        const p = easeOutCubic(prog(t, T[i] - 0.45, 0.45));
        if (p > 0) fx = lerp(xs[i - 1], xs[i], p);
      }
      fill.setAttribute('x2', fx.toFixed(1));
      sdots.forEach((s, i) => {
        const on = t >= T[i];
        s.d.setAttribute('fill', on ? C.accent : '#0F1A2E');
        s.d.setAttribute('stroke', on ? C.accent : C.line2);
        s.l.setAttribute('fill', on ? C.ink : C.muted);
      });
      void hk; void sg; void out;
    };
  }

  // ─────────────────────────────────────────── 3 · timeline (Gantt)
  buildGantt(root) {
    const X0 = 170, X1 = 1650, Y0 = 2026, Y1 = 2033;
    const x = (yr) => X0 + ((yr - Y0) / (Y1 - Y0)) * (X1 - X0);
    const mono = { 'font-family': 'IBM Plex Mono' };
    const ROW1 = 100, ROW2 = 214, AXIS = 292;
    const base = svg('g', {}, root);
    for (let y = Y0; y <= Y1; y++) svg('line', { x1: x(y), y1: 40, x2: x(y), y2: AXIS, stroke: C.grid, 'stroke-width': 1 }, base);
    svg('line', { x1: X0, y1: AXIS, x2: X1, y2: AXIS, stroke: C.line2, 'stroke-width': 1 }, base);
    for (let y = Y0; y < Y1; y++) text(base, x(y + 0.5), AXIS + 28, String(y), { 'text-anchor': 'middle', fill: C.foot, 'font-size': 15, ...mono });
    text(base, 0, ROW1 - 4, 'SINGAPORE', { fill: C.muted, 'font-size': 13, ...mono, 'letter-spacing': '0.12em' });
    text(base, 0, ROW1 + 14, 'DEPLOYMENT', { fill: C.muted, 'font-size': 13, ...mono, 'letter-spacing': '0.12em' });
    text(base, 0, ROW2 + 5, 'THIS PROJECT', { fill: C.accent, 'font-size': 13, ...mono, 'letter-spacing': '0.12em' });

    // overlap highlight (2028 inside Phase 1)
    const hl = svg('rect', { x: x(2028), y: 36, width: x(2029) - x(2028), height: AXIS - 36, fill: C.accent, 'fill-opacity': 0.08, stroke: C.accent, 'stroke-opacity': 0.35 }, root);

    // now marker
    const nowG = svg('g', tipAttrs('Now · September 2026', 'Proposal submitted (A*STAR/RGC 1). The Hong Kong team operates HKSim and, per the project team, holds Hong Kong robotaxi operations data.', 'Proposal Part II; project team'), root);
    const xn = x(2026 + 8.5 / 12);
    svg('rect', { x: xn - 10, y: 142, width: 20, height: AXIS - 142, fill: 'transparent' }, nowG);
    svg('line', { x1: xn, y1: 146, x2: xn, y2: AXIS, stroke: C.ink, 'stroke-width': 1.5 }, nowG);
    svg('circle', { cx: xn, cy: 146, r: 4, fill: C.ink }, nowG);
    text(nowG, xn + 10, 151, 'NOW · proposal submitted (Sep 2026)', { fill: C.ink, 'font-size': 13, ...mono, 'letter-spacing': '0.06em' });

    // Phase bars
    const H = 34;
    const p1x = x(2027 + 7 / 12), p1w = x(2029 + 7 / 12) - p1x;
    const p2x = p1x + p1w + 2, p2w = x(2032 + 7 / 12) - p2x;
    const p1 = svg('g', tipAttrs('Phase 1 · Aug 2027 – Jul 2029', '24 months: robotaxi cases in Hong Kong and Singapore. LLM agents coupled to the existing simulators in both cities. Up to S$150,000 (Singapore side).', 'Joint Call Guidelines 2026; proposal §3'), root);
    const p1r = svg('rect', { x: p1x, y: ROW2 - H / 2, width: 0, height: H, rx: 4, fill: C.amber }, p1);
    const p1t = text(p1, p1x + 14, ROW2 + 5, 'Phase 1 · 24 months · up to S$150,000', { fill: '#0C1626', 'font-size': 16, 'font-weight': 600 });
    const p2 = svg('g', tipAttrs('Phase 2 · months 25 to 60', 'If selected (up to 3 of the 10 projects): extends the framework to unmanned aerial vehicles (UAV) and integrated air-ground mobility. Up to S$300,000 (Singapore side).', 'Joint Call Guidelines 2026; proposal §6'), root);
    const p2r = svg('rect', { x: p2x, y: ROW2 - H / 2, width: 0, height: H, rx: 4, fill: C.slate }, p2);
    const p2t = text(p2, p2x + 14, ROW2 + 5, 'Phase 2 (if selected) · UAV + air-ground · up to S$300,000', { fill: C.ink, 'font-size': 16, 'font-weight': 500 });
    const startL = text(root, p1x, ROW2 + H / 2 + 24, 'Aug 2027 · expected start', { fill: C.muted, 'font-size': 14, ...mono });
    const mvp = svg('g', tipAttrs('Month 24 · 2029', 'Phase 1 ends: an MVP validated on independent evidence, with robotaxi cases in both cities.', 'Proposal §3 Objectives and Key Results'), root);
    const mx = p1x + p1w + 1;
    svg('path', { d: `M${mx},${ROW2 - H / 2 - 9} l7,7 l-7,7 l-7,-7 Z`, fill: C.ink, stroke: '#0C1626', 'stroke-width': 2 }, mvp);
    text(mvp, mx + 16, ROW2 + H / 2 + 24, 'Month 24 · MVP validated on independent evidence', { fill: C.soft, 'font-size': 14, ...mono });
    svg('rect', { x: mx - 12, y: ROW2 - H / 2 - 12, width: 24, height: 24, fill: 'transparent' }, mvp);

    // deployment events
    const pg = svg('g', tipAttrs('1 April 2026 · Punggol', 'Public autonomous shuttle rides began in Punggol (Land Transport Authority).', 'LTA news release, 4 Mar 2026'), root);
    const px = x(2026 + 3 / 12);
    const pgD = svg('path', { d: `M${px},${ROW1 - 11} l11,11 l-11,11 l-11,-11 Z`, fill: C.cyan, stroke: '#0C1626', 'stroke-width': 2 }, pg);
    const pgT = text(pg, px - 11, ROW1 - 26, 'Apr 2026 · Punggol autonomous shuttle rides', { fill: C.ink, 'font-size': 15 });
    const wm = svg('g', { ...tipAttrs('2028 · Waymo, Singapore', 'Waymo plans a commercial robotaxi service in Singapore in 2028, announced with MOT and LTA: inside Phase 1.', 'Waymo announcement, 18 Sep 2026'), 'data-key': 'waymo', 'data-tip-place': 'left' }, root);
    const wx = x(2028), ww = x(2029) - x(2028) - 2;
    const wmR = svg('rect', { x: wx + 1, y: ROW1 - 15, width: 0, height: 30, rx: 4, fill: C.cyan }, wm);
    const wmT = text(wm, wx + 1, ROW1 - 26, '2028 · Waymo plans a commercial robotaxi service (with MOT, LTA)', { fill: C.ink, 'font-size': 15 });
    // legend for row 1 / row 2 marks
    const leg = svg('g', {}, root);
    svg('rect', { x: 1240, y: ROW1 - 7, width: 14, height: 14, rx: 3, fill: C.cyan }, leg);
    text(leg, 1262, ROW1 + 5, 'Deployment milestone', { fill: C.soft, 'font-size': 15 });
    svg('rect', { x: 1440, y: ROW1 - 7, width: 14, height: 14, rx: 3, fill: C.amber }, leg);
    text(leg, 1462, ROW1 + 5, 'Project phase', { fill: C.soft, 'font-size': 15 });

    return (t) => {
      if (t < 15.6 || t > 20.4) return;
      show(base, smooth(prog(t, 16.05, 0.45)));
      show(leg, smooth(prog(t, 16.3, 0.4)));
      show(nowG, smooth(prog(t, 16.3, 0.4)));
      p1r.setAttribute('width', (p1w * easeOutCubic(prog(t, 16.4, 0.65))).toFixed(1));
      show(p1t, smooth(prog(t, 16.85, 0.3)));
      show(startL, smooth(prog(t, 16.9, 0.3)));
      p2r.setAttribute('width', (p2w * easeOutCubic(prog(t, 16.9, 0.65))).toFixed(1));
      show(p2t, smooth(prog(t, 17.35, 0.3)));
      show(mvp, smooth(prog(t, 17.55, 0.35)));
      const pa = easeOutBack(prog(t, 17.0, 0.4));
      pgD.setAttribute('transform', `translate(${px} ${ROW1}) scale(${Math.max(0, pa)}) translate(${-px} ${-ROW1})`);
      show(pgT, smooth(prog(t, 17.1, 0.3)));
      wmR.setAttribute('width', (ww * easeOutCubic(prog(t, 17.25, 0.45))).toFixed(1));
      show(wmT, smooth(prog(t, 17.45, 0.3)));
      show(hl, smooth(prog(t, 17.85, 0.45)));
    };
  }

  // ─────────────────────────────────────────── 4 · meter + funding
  buildMeter(root) {
    const cx = 110, cy = 110, r = 88, circ = 2 * Math.PI * r;
    svg('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(242,179,61,0.16)', 'stroke-width': 18 }, root);
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k / 10) * 2 * Math.PI;
      svg('line', { x1: cx + (r - 13) * Math.cos(a), y1: cy + (r - 13) * Math.sin(a), x2: cx + (r + 13) * Math.cos(a), y2: cy + (r + 13) * Math.sin(a), stroke: '#0C1626', 'stroke-width': 2 }, root);
    }
    const arc = svg('circle', { cx, cy, r, fill: 'none', stroke: C.accent, 'stroke-width': 18, transform: `rotate(-90 ${cx} ${cy})`, 'stroke-dasharray': `0 ${circ}` }, root);
    text(root, cx, cy - 6, 'SHARE OF', { 'text-anchor': 'middle', fill: C.muted, 'font-size': 14, 'font-family': 'IBM Plex Mono', 'letter-spacing': '0.1em' });
    text(root, cx, cy + 18, '1 FTE', { 'text-anchor': 'middle', fill: C.ink, 'font-size': 20, 'font-family': 'IBM Plex Mono' });
    const num = this.q('#meter-num');
    return (t) => {
      if (t < 20.2 || t > 24.2) return;
      const p = easeOutCubic(prog(t, 20.9, 0.9));
      arc.setAttribute('stroke-dasharray', `${(circ * 0.1 * p).toFixed(2)} ${circ}`);
      num.textContent = `${Math.round(10 * p)}%`;
    };
  }

  buildFund(root, tin, segs) {
    const W = 960, H = 34, total = segs.reduce((s, d) => s + d.v, 0);
    let x0 = 0;
    const parts = segs.map((s, i) => {
      const w = (s.v / total) * W - (i < segs.length - 1 ? 1 : 0);
      const g = svg('g', { ...tipAttrs(...s.tip), ...(s.id ? { 'data-key': s.id } : {}) }, root);
      const r = svg('rect', { x: x0 + (i ? 1 : 0), y: 0, width: 0, height: H, rx: 4, fill: i === 0 ? C.amber : C.slate }, g);
      const l = text(g, x0 + (i ? 1 : 0) + 14, H / 2 + 6, s.label, { fill: i === 0 ? '#0C1626' : C.ink, 'font-size': 16, 'font-weight': 600 });
      const part = { r, l, w, x: x0 };
      x0 += w + 2;
      return part;
    });
    return (t) => {
      if (t < 20.2 || t > 24.2) return;
      parts.forEach((p, i) => {
        p.r.setAttribute('width', Math.max(0, p.w * easeOutCubic(prog(t, tin + i * 0.35, 0.6))).toFixed(1));
        show(p.l, smooth(prog(t, tin + i * 0.35 + 0.45, 0.3)));
      });
    };
  }

  buildYears(root) {
    const cells = [];
    for (let i = 0; i < 5; i++) {
      const x = i * 66;
      const r = svg('rect', { x, y: 0, width: 62, height: 20, rx: 4, fill: i < 2 ? C.amber : 'none', stroke: i < 2 ? 'none' : C.line2, 'stroke-width': 1.5 }, root);
      text(root, x + 31, 40, `Y${i + 1}`, { 'text-anchor': 'middle', fill: C.foot, 'font-size': 13, 'font-family': 'IBM Plex Mono' });
      cells.push(r);
    }
    const lab = text(root, 0, 62, 'Y1–Y2 Phase 1 · Y3–Y5 Phase 2, if selected', { fill: C.muted, 'font-size': 13, 'font-family': 'IBM Plex Mono' });
    return (t) => {
      if (t < 24 || t > 27.4) return;
      cells.forEach((c, i) => show(c, smooth(prog(t, 24.75 + i * 0.12, 0.3))));
      show(lab, smooth(prog(t, 25.4, 0.3)));
    };
  }

  // ─────────────────────────────────────────── tooltip + cursor
  stageRect(node) {
    const s = this.stage.getBoundingClientRect();
    const k = s.width / 1920;
    const r = node.getBoundingClientRect();
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
  }

  showTip(node, a) {
    if (!node || a <= 0) { this.tip.style.opacity = 0; return; }
    if (this.tipFor !== node) {
      this.tipTitle.textContent = node.dataset.tipTitle;
      this.tipBody.textContent = node.dataset.tipBody;
      this.tipSrc.textContent = node.dataset.tipSrc ? `Source: ${node.dataset.tipSrc}` : '';
      this.tipFor = node;
    }
    const r = this.stageRect(node);
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    let left = clamp(r.x + r.w / 2 - w / 2, 24, 1920 - w - 24);
    let top = r.y - h - 16;
    if (node.dataset.tipPlace === 'left') { left = r.x - w - 20; top = r.y + r.h / 2 - h / 2; }
    if (top < 24) top = r.y + r.h + 16;
    this.tip.style.opacity = a;
    this.tip.style.transform = `translate3d(${left.toFixed(1)}px, ${(top + (1 - a) * 8).toFixed(1)}px, 0)`;
  }

  updatePointer(t) {
    let cur = null, a = 0, ca = 0, cx = 0, cy = 0, rp = -1;
    for (const g of this.guided) {
      if (t < g.t0 - 0.05 || t > g.t1 + 0.2 || !g.target) continue;
      const r = this.stageRect(g.point ?? g.target);
      const tx = r.x + r.w * 0.62, ty = r.y + r.h * 0.6;
      const sx = 1560, sy = 1010;
      const m = easeInOutCubic(prog(t, g.t0, g.arrive - g.t0));
      cx = lerp(sx, tx, m); cy = lerp(sy, ty, m);
      ca = envelope(t, g.t0, 0.2, g.t1 - 0.15, 0.25);
      rp = t - g.arrive;
      a = envelope(t, g.arrive + 0.05, 0.25, g.t1 - 0.2, 0.25);
      cur = g.target;
    }
    const hovered = this.hover && this.hover.closest('.scene')?.classList.contains('on')
      && Number(getComputedStyle(this.hover).opacity) > 0.5 ? this.hover : null;
    if (hovered) this.showTip(hovered, 1);
    else this.showTip(cur, a);
    const demo = !this.interactive;
    this.cursor.style.opacity = demo ? ca : 0;
    this.cursor.style.transform = `translate3d(${(cx - 5.6).toFixed(1)}px, ${(cy - 2.4).toFixed(1)}px, 0)`;
    const rr = clamp(rp / 0.5);
    this.ripple.style.opacity = demo && rp >= 0 && rp <= 0.5 ? (1 - rr) * 0.9 : 0;
    this.ripple.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) scale(${(0.3 + rr * 0.9).toFixed(3)})`;
  }

  // ─────────────────────────────────────────── per-frame update
  update(t) {
    for (const s of this.scenes) {
      const on = t >= s.start - 0.02 && (t < s.end || (s.end >= 30 && t <= s.end));
      if (on !== s.on) { s.el.classList.toggle('on', on); s.on = on; }
    }
    for (const it of this.items) {
      if (it.scene && !it.scene.classList.contains('on')) continue;
      this.applyItem(it, t);
    }
    for (const c of this.counters) {
      const p = easeOutCubic(prog(t, c.tin, 1.1));
      c.node.textContent = `${c.prefix}${fmtInt(c.to * p)}${c.suffix}`;
    }
    for (const u of this.updaters) u(t);

    // rail
    const rail = envelope(t, 7.0, 0.5, 27.05, 0.4);
    this.q('#rail').style.opacity = rail;
    const idx = t < 15.7 ? 0 : t < 20.3 ? 1 : 2;
    this.railDots.forEach((d, i) => d.classList.toggle('on', i === idx));
    this.railNames.forEach((d, i) => d.classList.toggle('on', i === idx));

    // scrims
    const info = envelope(t, 6.8, 0.7, 27.05, 0.6);
    this.q('#scrim-left').style.opacity = info;
    this.q('#scrim-full').style.opacity = 0.32 * info + 0.18 * smooth(prog(t, 27.2, 0.8));
    this.q('#scrim-bottom').style.opacity = Math.max(envelope(t, 4.0, 0.7, 6.9, 0.5), 0.45 * info);
    this.q('#scrim-center').style.opacity = Math.max(0.85 * envelope(t, 2.3, 0.5, 4.25, 0.4), smooth(prog(t, 27.25, 0.7)));
    this.q('#fade').style.opacity = 1 - smooth(prog(t, 0, 0.7));
    this.q('#progress span').style.width = `${((t / 30) * 100).toFixed(3)}%`;

    this.updatePointer(t);
  }
}
