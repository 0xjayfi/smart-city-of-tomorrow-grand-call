# AI for Smart Cities of Tomorrow · 30-second film

A 30-second video version of the poster *Small Grant, Front-Row Seat*, for the
A\*STAR/RGC Joint Research Scheme proposal on AI residents for transport policy
evaluation in Hong Kong and Singapore.

| File | What it is |
|---|---|
| `output/smart-city-of-tomorrow-30s.mp4` | The film: 1920×1080, 30 fps, H.264 + AAC, 30.0 s |
| `output/poster-frame.png` | Still for a thumbnail or the first slide |
| `output/soundtrack.mp3` | The original score on its own |
| `video/` | Source of the film: a frame-accurate HTML/WebGL animation |

The same source also runs as an interactive player in a browser, with hover
tooltips on the charts, chapter buttons, a scrubber and optional sound.

## Storyboard

| Time | Scene | What the viewer sees | Source (as cited on the poster) |
|---|---|---|---|
| 0:00–0:07 | Opening | A network of nodes becomes a harbour city at night: towers rise, robotaxi traffic fills the streets, drones fly between vertiports. Title, then *Robotaxis on the streets. Drones in the air. How do we test transport policy before it reaches the street?* | Poster title and scope (robotaxi, UAV, air-ground mobility) |
| 0:07–0:11 | The gap | Side-by-side agent animation: a rule-based agent ignores a new robotaxi option; an AI resident reasons about it and adapts. Labelled illustrative. | Proposal Part II §1, §4 |
| 0:11–0:16 | The approach | HKSim and the Singapore island-wide simulator feed a calibration loop (diagnose → targeted alignment → re-evaluate) that outputs policy evaluation; Model → Self-improve → Validate → Generalize. The three expected outcomes. | Proposal Part II §1, §3 |
| 0:16–0:20 | Why now | Timeline 2026–2032: Punggol shuttle rides (Apr 2026), proposal (Sep 2026), Phase 1 (Aug 2027 to Jul 2029, up to S$150,000), Waymo's planned 2028 Singapore launch inside Phase 1, Phase 2 if selected. A cursor opens the 2028 tooltip. What Phase 1 evaluates. | Proposal Part II §4, §6, §10, Section 3; Joint Call Guidelines 2026; LTA news release 4 Mar 2026; Waymo announcement 18 Sep 2026 |
| 0:20–0:24 | Commitment | 10% FTE meter over 24 months; 0 departmental staff. Alongside: up to S$150,000 (Singapore side, Phase 1) and HK$2,770,560 (Hong Kong side, five years), each split by phase; 1 PhD student + 1 post-doc; 8 × NVIDIA H200 GPUs. | Proposal Section 3, Part II §9, §10; Co-I declaration |
| 0:24–0:27 | Benefits | Four benefits to the department: programme role (2 years, up to 5), framework reusable on the department's simulators including SITEM, an established partner for follow-on bids, an early position in robotaxi policy evaluation. | Proposal Part II §10 |
| 0:27–0:30 | Request | *Small grant, front-row seat.* Request: departmental support for a 10% FTE commitment through Phase 1. Investigators. | Poster slide 3 |

## Accuracy notes

- Every number, date and claim on screen comes from the poster and the sources
  it cites. Nothing was added or estimated.
- The city and the agent animation are illustrations, not simulation output.
  The agent panel says so on screen.
- Singapore-dollar and Hong Kong-dollar amounts are never put on one axis. Each
  funding bar shows one side's split by phase on its own scale.
- Phase 1 is drawn as August 2027 to July 2029 (24 months). Phase 2 is drawn as
  months 25 to 60 and marked "if selected". Waymo's launch is drawn as the whole
  of 2028, because only the year has been announced.
- Chart colours were checked for colour-vision-deficiency separation and
  contrast against the dark background.

## Regenerate

Requires Node 18+ and ffmpeg.

```bash
npm install
npm run audio        # synthesise output/soundtrack.wav (+ encode the mp3 with ffmpeg, see below)
npm run render       # capture 900 frames with headless Chromium and encode the mp4
npm run build:web    # single-page web player in dist/web/
```

`ffmpeg -i output/soundtrack.wav -c:a libmp3lame -b:a 192k output/soundtrack.mp3`
makes the mp3 the web player uses.

To preview the interactive player, run `npm run preview` and open
`http://localhost:8080/video/`. Space plays or pauses; the arrow keys skip two
seconds; `?t=18` opens at a given second.

Useful flags for `scripts/render.mjs`: `--stills 3.9,18.9` renders single
frames to `output/stills/`; `--fps`, `--workers`, `--crf`, `--from`, `--to`.

## Credits

- 3D rendering: [three.js](https://threejs.org) (MIT).
- Type: Instrument Sans, Instrument Serif and IBM Plex Mono (SIL Open Font
  License 1.1), via Fontsource.
- Score: original, synthesised by `scripts/soundtrack.mjs`. No samples or
  third-party audio.
