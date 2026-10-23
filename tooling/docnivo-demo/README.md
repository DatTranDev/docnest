# Docnivo landing demo

`DocnivoLandingDemo`: silent 1920 × 1080, 30 fps, 450 frames, exactly 15 seconds. Remotion dependencies are isolated here; the web app ships ordinary video assets.

## Update and render

Install the repository dependencies with `npm ci`, then `npm --prefix tooling/docnivo-demo ci`. Start the real app or its existing local development gateway using the root README. From the repository root:

```powershell
$env:DEMO_ORIGIN = 'http://127.0.0.1:8080'
$env:DEMO_FRESH = '1'
npm --prefix tooling/docnivo-demo run capture
npm --prefix tooling/docnivo-demo run dev
npm --prefix tooling/docnivo-demo run lint
npm --prefix tooling/docnivo-demo run render
npm --prefix tooling/docnivo-demo run validate:video
npm run build
npm run build:local
```

Open the printed Studio URL and select **DocnivoLandingDemo**. `src/timeline.ts` centralizes scene timing, camera keyframes, captions and pointer paths. Frames 0–74 reveal the workspace; 75–179 create/write; 180–299 collaborate; 300–374 share; 375–449 return. Camera scale stays within 1.0–1.2 so controls remain visible. The common workspace plate anchors both ends, which must have identical lossless pixels.

Capture creates two fictional accounts, seeds two real documents, creates **Product Vision**, types/saves a draft, grants Jamie Editor access without email, verifies Jamie's text in Alex's session, saves the result, and creates/copies/revokes a real seven-day viewing link. No API responses are mocked. Credentials stay in ignored `.secrets/docnivo-demo.json`. `DEMO_FRESH=1` keeps the library stable; otherwise credentials are reused and another set of demo documents is created. Run only against a backend where fictional demo data is authorized.

The delivered footage came through the loopback development gateway against the existing backend because Docker was unavailable. `public/captures/` contains 2880 × 1400 screenshots, a genuine trimmed Playwright collaboration recording and sanitized capability evidence. Authentication footage remains ignored under `out/raw/`. Link characters are obscured before capture and revoked afterward. Capture stops on missing capabilities; never substitute invented screens or publish a partial capture.

The final film retimes authentic screenshots on a deterministic frame clock. Its browser frame, pointer and captions are authored overlays; the product UI and remote cursor are captured. The source recording is retained for review and alternative edits. Rendering separates 450 lossless PNGs from a two-thread H.264 encode to bound peak memory. Bundled FFmpeg generates MP4/VP9 WebM; the repository's existing Sharp generates the WebP poster. Outputs are copied to `out/` and `frontend/web/src/features/local-tools/assets/`.

## Review the integration

The landing serves muted inline looping video with WebM/MP4 sources, a poster, localized pause/resume and a transcript. Sources load when visible. Reduced motion, Save-Data and reported slow connections keep the poster until explicit Play. Playback pauses offscreen. The standalone site uses relative assets and no authenticated API requests.

```powershell
$env:DEMO_LANDING = 'http://127.0.0.1:8081/index.html'
npm --prefix tooling/docnivo-demo run validate:landing
node tooling/docnivo-demo/scripts/validate-fallback.mjs
```

These manual authoring checks are not CI gates. Video validation checks metadata, all 450 lossless frames for black/empty output, camera bounds and loop equality; it writes `out/validation.json` and a labeled boundary contact sheet. Landing validation uses the repository's pinned Playwright at desktop/tablet/390px/360px, including reduced motion, simulated data saving and explicit playback. Inspect full-speed playback, the contact sheet and landing captures. Actual results and limitations are recorded in `docs/PROJECT_STATUS.md`.

Inter uses the product's bundled font and accompanying `public/OFL.txt`. Remotion's own licensing terms apply to its use.
