# UI implementation workflow

`docs/design/UI_SYSTEM.md` is the canonical DocsNest interface contract. Read it with the relevant screen, nearby components, copy catalogs, contracts and latest `docs/PROJECT_STATUS.md` entry before editing UI. Design gallery boards are proposals; product behavior and API contracts govern implementation.

1. **Discover:** Identify the user's task, the screen's primary action, product mode (local, authenticated or public), and the state matrix: default, loading, empty, success, error, disabled, permission denied and offline where applicable. Note desktop/mobile and English/Vietnamese needs.
2. **Design:** Keep the calm, content-first DocsNest direction. Sketch hierarchy, density, responsive changes and keyboard/touch behavior. For substantial changes, write a short plan before coding. Use `frontend-design`, `ui-ux-pro-max` and `web-design-guidelines` when available; use `vercel-react-best-practices` for React/Next.js performance concerns.
3. **Build:** Reuse shared tokens and UI primitives. Keep copy localized, document paper independent of theme chrome, and local/cloud persistence wording truthful. Preserve routes, contracts, ACL behavior, editor-core ownership and feature boundaries.
4. **Observe → critique → refine:** Run the relevant local app or standalone site and follow `docs/visual-qa.md`. Inspect actual desktop, tablet and mobile captures plus important interactions. Name specific issues in hierarchy, spacing, typography, overflow, contrast, focus, touch size, states and main-action clarity; correct them and recapture as needed.
5. **Verify:** Run relevant formatting and static checks, then the required build-only commands from `AGENTS.md`. Do not restore deleted browser or integration suites as release gates. Record commands/results and any unobserved states in `docs/PROJECT_STATUS.md`.

Update `UI_SYSTEM.md` when a new decision is reusable across screens. Keep one-off details next to the component or feature.
