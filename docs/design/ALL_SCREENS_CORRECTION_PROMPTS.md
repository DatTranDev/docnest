# docsnest: image refinement prompts

## Targeted correction prompts

Each correction used the corresponding first-pass board as its sole edit target. Selected corrections are saved as `-v2.png` and linked from the gallery. Superseded first-pass PNGs were removed from the current tree to avoid duplicate assets; earlier commits retain them.

### 04-shared-trash

Use case: ui-mockup. Edit the supplied concept board, preserving all typography, colors, layout, rows, bottom empty state and Restore confirmation. Correct ONLY search controls: remove the generic header search boxes from both top app bars entirely. In the Shared with me content area keep just one search box labeled "Search names in shared files". Add one small scoped field below the Trash heading labeled "Search names in Trash", without moving the retention message or Restore controls out of view. No global search, no content search. Everything else unchanged.

### 05-library-states

Use case: ui-mockup. Edit supplied four-state library board. Preserve all four state messages, actions, skeleton rows, icon art and layout. Across ALL four panels, remove every "Date modified" and "Owner" filter; replace "Last modified" sorting with "Name (A–Z)". Keep only Type filter and Name sort. Change blank search placeholder to "Search names in My files". Existing filtered query biology and Type Markdown remain. Do not add other controls. Keep first-visit CTA, clear loaded-results wording and retry failure state exactly. Add the visible small loading label "Loading your files…" above skeletons in lower-left. No changed branding or decoration.

### 07-json

Use case: ui-mockup. Edit supplied JSON board, preserving source/result content, the independent-pane labels and mobile design. Remove all source-pane "Clear" links entirely, including the lower empty-result example. Change the desktop "Download source" button from solid blue to a secondary white button with subtle border; keep Share blue. In empty-result example disable BOTH Copy result and Download result visually, as well as the already disabled Replace source with result. Keep the explicit result scratch message and green status "Source JSON is valid". Do not change anything else.

### 08-local-document

Use case: ui-mockup. Edit supplied local-editor board. Preserve the desktop layout, content and Download dropdown except change the desktop font selector text "Segoe UI" to supported "Arial". Redesign ONLY the mobile top chrome to be substantially shorter. Keep a 48px brand row with back arrow, docsnest and overflow; put Sign in inside overflow, not as a separate visible action. Next one compact 48px row with "Draft.tedoc" on left and blue compact "Download" on right. Immediately below show one short status line "This tab only · Download to keep your work". Then ONE 44px control row: Document selector, B, I, list, Format. Move Open file into overflow. Eliminate the separate Open file/Download row, the separate full-width Document selector row, and any duplicate headings above the canvas. The actual writing heading "Ideas for my portfolio" must begin near 220px down from the mobile app's top, with much more document visible. Retain the prose/bullets and lower account bridge. No cloud Save or Share, no durable storage claims. Remove layout percentages from outer board captions; use "Desktop local editor" and "Mobile local editor".

### 10-versions-recovery

Use case: ui-mockup. Edit supplied history/recovery board with strict correctness corrections, preserving the recovery/conflict/offline right panels exactly. In LEFT historical document screen, retain title and "Viewing version 3 · Read only", but REMOVE all editing menus and formatting controls under it, including File, Insert, Format, font controls and B/I/U. Use only quiet Download and an explicit Back to current affordance near the title. Keep the existing history sidebar, selected Version 3, and "Save as a new document". Remove generated change-description summaries under every history version ("Updated next steps...", "Reworked questions...", "Added introduction...", "Initial outline", "Created document"). Retain only version number and date/time for each. Do not imply semantic version summaries exist. Keep paper text unchanged. No Restore-over-current action.

### 13-settings-plan

Use case: text-localization. Edit the supplied settings/plan concept image. Preserve all layout, visual design, labels and controls. In BOTH desktop and mobile plan panels change the Version history helper from "See and restore earlier versions." to exactly "View earlier versions and save a copy." The product cannot restore over the current document. This is the only change; preserve every other detail.
