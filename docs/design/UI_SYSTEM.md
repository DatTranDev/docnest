# DocsNest interface system

The workspace uses a calm, content-first interface: one prominent document-creation action, quiet navigation and metadata, and a paper-white writing surface. Authentication previews the same editor language with illustrative, localized sample content.

## Theme contract

`frontend/web/src/app/preferences.css` owns semantic chrome tokens. Both light and dark themes define backgrounds (`--ui-bg`, `--ui-surface`, `--ui-tile`), text (`--ui-ink`, `--ui-muted`), borders, selected surfaces, focus, overlay, and success/warning/danger pairs. `--ui-accent` is the text/icon accent; filled actions use `--ui-primary`, `--ui-primary-hover` and `--ui-on-primary`. These roles are separate so dark-theme links can be lighter without reducing white button-label contrast.

Use the shared `--ui-font` stack for interface text. Document fonts and stored formatting remain independent. Control/card/panel radii are 8/12/16px; spacing tokens follow 4/8/12/16/24/32px. Subtle transitions use `--ui-motion`, which becomes zero under reduced motion. Paper previews, editable pages and print sheets retain their own light foreground/background pairs in either theme.

## Layout and actions

- The desktop header is 64px high, search is bounded to 580px, and the sidebar is 232px wide. Selected navigation has a visible inset indicator.
- The library heading exposes New document and secondary Import actions. The existing New menu retains folder creation and file-type actions. Empty states direct attention to the heading instead of repeating the primary action.
- Document cards show title, type, paper preview and readable role/word-count metadata. Title and preview are separate document-opening regions; the action menu remains independent. Folders share the card border/radius language with a compact layout.
- At narrow widths cards use an adaptive column count with a 220px preferred minimum. List names truncate; preview and metadata remain at least 12px. Important touch controls and action-menu triggers have 44px hit areas.
- Editor representations use a native Edit as selector. Collaboration is a separate toggle; leaving it remains available when entering would be disabled by connectivity, permissions or document size.
- Undo/redo, text style, B/I/U, lists and alignment remain immediately available on desktop. Advanced typography and insertion tools use the formatting panel. File groups find/replace, page preview, history, image insertion and file operations; Download retains all export formats. Manual Save and eligible-owner Share remain in the header.
- Formatting panels reuse viewport-positioned `ToolMenu`, with outside dismissal, Escape/focus return and native input/select keys. Nested menus handle their own keys. Structural forms use the shared native modal dialog for focus containment and Escape dismissal.

## Boundaries

Keep UI copy in the English/Vietnamese catalogs. Do not infer save completion, permissions or document capabilities from presentation. Keep source data, editor history/selection, worker behavior, API requests, storage formats and public contracts in their existing owners. The auth product preview is static presentation and must not initialize an editor or request account/document data.

Execution receipts, screenshots and remaining validation limits are recorded only in `docs/PROJECT_STATUS.md`.
