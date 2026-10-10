# docsnest — Text Editor

A web editor for large text documents with formatting, folders, sharing, version history and exports. The local stack uses Next.js/CodeMirror, five Spring Boot services, MySQL, Kafka and Redis. The Collaboration service adds opt-in concurrent editing with Yjs CRDT.

For current project status and benchmark results, see [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md). Cloud setup instructions are in [docs/CLOUD_SETUP_HANDOFF.md](docs/CLOUD_SETUP_HANDOFF.md); cloud resources are not created by local commands.

## Run the app

Install Docker Desktop with Linux containers, Docker Compose v2, and Python 3.12.6 or newer. From the repository root, run:

```powershell
python -X utf8 tooling/scripts/run.py up
```

Open [http://localhost:8080](http://localhost:8080) and register two accounts to try sharing. The first run creates a local `.env` file and builds the app images. MySQL, Kafka, documents and the signing key persist in Docker volumes. Stop the app with:

```powershell
python -X utf8 tooling/scripts/run.py down
```

This keeps the saved data. Do not use `docker compose down -v` unless you intend to erase the local database and files.

Choose **Tiếng Việt** or **English** in the language selector on the login, workspace or public document page. Vietnamese is the default; the browser remembers your choice. Switching languages preserves unsaved edits and undo history. Document text, titles, font names and API identifiers are unchanged.

Formatting includes font/size/color, bold/italic/underline, highlight, strikethrough, super/subscript, paragraph alignment, title/heading appearance presets and clear formatting. Native files preserve formatting; TXT exports plain text and HTML preserves supported styles. Heading presets currently set appearance, without an outline or table of contents. Lists, indentation/line spacing, hyperlinks, editable tables, stored page breaks and plain-text headers/footers are supported. A4 preview shows page settings; File exports DOCX/PDF through Processing. Office exports are bounded to 200,000 UTF-16 units and 2,000 paragraphs; use TXT/HTML for larger documents. Import accepts TXT/native only. Tables have one canonical paragraph per cell; Tab/Enter moves between cells. PDF uses bundled Noto fonts rather than exact Microsoft-font metrics.

For concurrent editing, share a document with another account as **EDITOR**, then both users open it and choose **Cùng chỉnh sửa**. Collaboration currently supports up to 200,000 UTF-16 units; the normal large-file editor retains its existing limits. See [protocol and current limitations](docs/contracts/collaboration.md). Cloud templates include the service; deployment and real GCS validation remain pending.

For subscription setup, see [docs/STRIPE_SETUP.md](docs/STRIPE_SETUP.md). The workspace has a **Gói dịch vụ** panel. Stripe test keys are optional for local editing; live billing is not enabled. Payment orchestrates subscription entitlements with transactional outbox/inbox across the four other services.

## Common commands

| Command                                           | Purpose                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `python -X utf8 tooling/scripts/run.py up`        | Build and start the full app                                         |
| `python -X utf8 tooling/scripts/run.py down`      | Stop it and keep its data                                            |
| `python -X utf8 tooling/scripts/run.py build`     | Build Java and frontend code                                         |
| `python -X utf8 tooling/scripts/run.py test`      | Run quality gates, service tests and frontend tests; Docker required |
| `python -X utf8 tooling/scripts/run.py quality`   | Run formatting, lint, type and contract checks                       |
| `python -X utf8 tooling/scripts/run.py smoke`     | Check a running local app and its services                           |
| `python -X utf8 tooling/scripts/run.py benchmark` | Measure large-file browser workloads                                 |
| `python -X utf8 tooling/scripts/run.py backup`    | Back up local app data                                               |

Development and test commands also need JDK 21 and Node 24. Install dependencies with `npm ci`; install Chromium with `npx playwright install chromium`. Python quality tools are pinned in `testing/checks/requirements-implementation.txt`. Full command details and recovery steps are in [testing/checks/README.md](testing/checks/README.md).

With the local app running, `node testing/checks/collaboration-browser.cjs` checks concurrent editing and recovery against real services. `node testing/benchmark/collaboration.cjs` measures the collaboration size boundary; its JS-heap measurement is separate from the full browser RAM benchmark.

`node testing/checks/i18n-browser.cjs` checks both languages against the running application, including offline edits, save/reopen, image labels, public viewing and mobile layout.

The workspace offers grid/list views, text previews, title search in the current library, item-type filters and keyboard-accessible action menus. `node testing/checks/workspace-browser.cjs` checks these against real services, including rename/move/trash/restore, viewer permissions, editor preservation and desktop/mobile layout. It uses the existing disposable smoke accounts and cleans up its own fixture folder/documents. Set `SMOKE_OWNER_EMAIL` when running the i18n browser check with a different smoke account.

## Where things live

| Folder           | Contents                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `backend/`       | Identity, Document, Processing, Collaboration and Payment services; shared Java code and SQL migrations |
| `frontend/`      | Next.js application and framework-independent editor core                                               |
| `infra/compose/` | Local Docker stack, Dockerfiles and MySQL/Kafka setup                                                   |
| `infra/gcp/`     | Terraform and VM deployment templates                                                                   |
| `infra/k8s/`     | Kubernetes manifests and lab overlay                                                                    |
| `testing/`       | Cross-service checks and benchmarks                                                                     |
| `tooling/`       | Local build, test, run and deployment scripts                                                           |
| `docs/`          | Product/design docs, API/event contracts and setup guides                                               |

Unit tests live beside the code they exercise. Root Maven/npm files coordinate builds across workspaces. Generated files such as `node_modules/`, `target/`, `.terraform/` and benchmark output are local build artifacts and are ignored by Git.

### Backend layer map

Each service keeps its own database and organizes code by feature. HTTP request DTOs live in `api/dto`; application command and query records model use-case input/output. Controllers depend on `*Service` interfaces, implemented by the corresponding handlers. Persistence interfaces live in `application/port` and use `*Repository` names. JDBC implementations use `Jdbc*Dao` names under `infrastructure`; they retain the existing SQL transactions, locks, and outbox/inbox writes. `bootstrap` wires the layers. Domain types stay plain Java.

## Cloud

Cloud templates use placeholders. Configure them by following [docs/CLOUD_SETUP_HANDOFF.md](docs/CLOUD_SETUP_HANDOFF.md), review the cost estimate against the USD 300 learning budget, and only then run its deployment steps. Local validation commands do not deploy or create paid resources.

## docsnest preferences and Word interchange

The account menu opens Settings (Cài đặt): English/Vietnamese and Light/Dark/Use browser setting. Language and appearance persist under a separate account key in this browser; they are not synced between devices. If browser storage is blocked, changes remain in memory for the session. Document pages remain white in dark mode so stored text colours and print output retain their meaning. Customizable native selects style the dropdown popup on supporting browsers; other browsers retain their accessible native picker.

The New menu imports TXT/native/DOCX into a new document. The editor File menu imports into the current editable document, with confirmation before replacing DOCX contents. Existing unsaved contents are checkpointed. Save the imported document before sharing/exporting it. File → Export DOCX or Export PDF starts the existing authenticated background job, and Download result retrieves the real output.

DOCX import preserves supported Unicode text, headings, B/I/U, common character colours/fonts/sizes, highlight/strike/script, safe links, basic lists/paragraph spacing, rectangular tables with one paragraph per cell, inline PNG/JPEG, simple header/footer and PAGE fields. Files are bounded to 16 MiB compressed/32 MiB expanded, 512 ZIP entries, 200,000 UTF-16 units and 2,000 paragraphs. ZIP integrity, real expansion, XML, image and native-model limits are checked before replacing content. Complex sections, merged/nested/multiparagraph cells, tracked changes, content controls, embedded objects, floating drawings, references and unsupported fields are rejected without changing the editor. Exact Word page/font layout is not guaranteed. PDF import and legacy .doc import are outside this change.

`node testing/checks/docsnest-browser.cjs` exercises native dropdown keyboard use, account-isolated settings and system appearance, responsive subscriptions, actual DOCX import/save/reopen/roundtrip and authenticated Kafka DOCX/PDF downloads against the running local services. It uses the existing disposable smoke accounts and cleans up only its own document ID. It does not execute a payment.

## Introduction and local tools

The app provides `/intro` (product introduction) and `/local` (no-login local editor), linked from login and workspace. Four independent, mounted editors retain contents/history across mode switches:

- Document: the canonical rich editor, TXT/native/DOCX import, local native/TXT/HTML/DOCX downloads and browser Print / Save PDF.
- Markdown: MD/Markdown files, formatting toolbar, source/split/preview, fixed pane labels and bidirectional scrolling by corresponding content in split view, GFM tables/checklists, highlighted fenced code, HTML download and browser Print / Save PDF. Raw HTML is inert; remote images are labels and are never automatically fetched.
- Code: line numbers, syntax highlighting and indentation for JavaScript, TypeScript, Python, HTML, CSS and JSON; plain text fallback. Code is never executed.
- JSON: two editable panes for source and result. Validate, format with 2/4 spaces or minify into the right pane, then edit/copy/download the result or explicitly use it as the source. Errors report line/column. Raw number/string tokens, duplicate keys and property order are preserved, including integers beyond JavaScript's safe numeric range. Invalid transformations retain both panes.

Local files remain in the current session; download to retain work. Editing needs no login and does not upload content. The header links to sign-in/file management and shows an initial avatar from the last successful session on the same host, without background authentication calls. The avatar hint contains no token/email/ID and does not authorize access; the workspace verifies the session. UTF-8 source import is bounded to 1 MiB; editing and JSON output to 1,048,576 UTF-16 units, JSON to 100 nested levels/200,000 tokens. Markdown preview/HTML export is bounded to 200,000 units. Canonical document/Office import/export bounds remain. English/Vietnamese and light/dark/browser appearance are available; local theme storage is separate from account preferences.

Authenticated file management supports `.md`, `.markdown`, `.json`, `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.html` and `.css`: create/import, edit with source highlighting, save versions, download the original text format, share/view, recover offline drafts and detect conflicting revisions. Markdown opens with synchronized preview; JSON opens with both panes. File types are inferred from title extensions; renaming without a supported extension retains the previous suffix. Source bytes use the existing canonical snapshot/upload protocol internally, with BOM/CRLF export preferences, ACL and optimistic revision checks. Existing titles without these suffixes use the rich editor. No schema/API/native-format migration was added.

Build/serve the independent site without Java, MySQL, Kafka, Redis or a Next.js server:

```powershell
npm ci
npm run build:local
npm run preview:local
```

Open `http://127.0.0.1:8081/index.html` and `editor.html`. Host `frontend/web/dist/local-site/` on any static HTTP host, including a subdirectory. Scripts, styles, fonts and Workers use relative asset paths; runtime CDNs are unnecessary. The bundled OFL Noto Serif font supports Vietnamese headings. Browser Print / Save PDF opens the browser's print dialog; the local site does not use background export jobs.

For a separate hosted application, set `NEXT_PUBLIC_APP_URL` to its URL before `npm run build:local`; this configures navigation links only. The local loopback default points to the application on port 8080. Local Compose accepts both `localhost:8080` and `127.0.0.1:8080` for auth CSRF. LOCAL uploads use the current gateway origin; signed cloud uploads retain their original URL and credential rules.

`node testing/checks/local-tools-browser.cjs` serves the actual compiled output on an ephemeral port and checks real downloads/DOCX roundtrip, offline edits, safe Markdown, syntax colors, lossless JSON, retained editor DOM, both languages/themes and mobile; it asserts zero API/external requests. Run `npm run build:local` first and install the pinned Playwright Chromium. Backend services are unnecessary.

`node testing/checks/source-files-browser.cjs` checks real managed MD/JSON/code saves/reopens/downloads, source edits, JSON results, filtering, offline recovery, conflicting revisions, viewer ACL, sign-in/avatar/logout and mobile against Compose. It serves the compiled standalone site on its own ephemeral port, uses the existing disposable smoke accounts and trashes only its own document IDs. It never logs credentials or document contents.
