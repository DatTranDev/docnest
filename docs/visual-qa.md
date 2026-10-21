# Manual visual QA

Use this workflow for UI changes. It is a manual review aid, not a CI or deployment gate. The browser package is already pinned in `frontend/web/package.json`; do not add another browser test stack.

## Capture

1. Start the local application from the root README, or run `npm run build:local` then `npm run preview:local` for the standalone public site. Use local/test data only. Do not record authenticated pages containing private documents without a dedicated fictional account.
2. For the Next.js public introduction, run `node testing/visual-qa/capture.mjs --url http://127.0.0.1:8080/intro --label intro`. For the standalone introduction, use `http://127.0.0.1:8081/index.html` and a distinct label. A local editor deep link can use `/local?mode=document` with label `local-editor`.
3. Inspect all generated PNGs at desktop 1440 × 900, tablet 768 × 1024 and mobile 390 × 844. Read `observations.json` for HTTP status, page errors and page-level horizontal overflow. The files are ignored under `testing/reports/visual-qa/`.
4. Check the primary action, navigation, focus order and visible focus, keyboard operation, loading/empty/error and dialog states relevant to the task. Review English and Vietnamese, light and dark themes, long document names, reduced motion and a narrow 360px viewport when the changed surface needs them. Capture additional states with a project-specific manual walkthrough.
5. Record only observed findings and the actual verification commands in `docs/PROJECT_STATUS.md`. Fix important issues, capture again and stop when no substantial issue remains. Never describe a build or screenshot command alone as visual inspection.

The script accepts only loopback HTTP URLs. It does not authenticate, seed data, compare baselines or replace functional testing. If Chromium is missing, run `npx playwright install chromium` and repeat the capture. Do not commit generated screenshots unless they are intentionally curated design evidence.
