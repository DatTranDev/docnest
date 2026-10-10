# Product specification and MVP acceptance criteria

The product name is **docsnest** in both languages. Users can create folders and documents, enter and format text, save to the cloud, reopen documents and share them. The learning goal is to build complete product flows and exercise distributed failures on Google Cloud. Initial users form a small test group; production availability is not a requirement.

## Scope

| Area       | MVP                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts   | Register, log in, refresh tokens, log out and view profile                                                                                          |
| Folders    | Create, rename and move within a personal tree; delete empty folders                                                                                |
| Documents  | Create empty, rename, move, open, edit, save, list versions, trash and restore                                                                      |
| Editor     | Bold, italic, underline, basic font family/size/color, paragraph alignment; undo/redo; literal find/replace; import TXT/native; download native/TXT |
| Sharing    | Grant VIEWER/EDITOR to existing accounts; Shared with me; revoke; read-only public links                                                            |
| Processing | Automatic preview and word count; TXT/HTML exports with job status                                                                                  |
| Offline    | Recover drafts through IndexedDB; no automatic queue that overwrites cloud content on reconnect                                                     |

Outside the MVP: folder sharing, email invitations, OTP/email verification, email password reset, real-time OT/CRDT, tables, DOCX/RTF round trips, a mobile editor, unbounded regular expressions, and multiple active large documents. PNG/JPEG insertion and a bounded read-only A4 page preview are supported. These are lab scope decisions, not claims that the other features are impossible.

## Screens

1. Login and Register. Show input validation errors. Keep the access token in memory and the refresh token in an HttpOnly cookie.
2. Workspace. The sidebar contains My documents, Shared with me and Trash, with a New menu for folders/documents. A wide library surface shows folder breadcrumbs, compact folder tiles and document cards with actual text previews, or a compact list. Remember the grid/list preference. Search document titles and folder names in the current scope/folder, filter by item type and sort visible items by name. Document pages contain 50 items with Load more. Item menus provide Open, Rename, Move, Delete/Trash or Restore according to ownership; support keyboard navigation and keep menus inside the viewport. Account actions and subscription plans remain accessible on mobile.
3. Editor. Show the document title, owner-only breadcrumb, permission label, B/I/U, font, size, color and paragraph alignment controls, undo/redo, search, Save, Export and Share. Statuses are Saved, Unsaved, Saving, Offline and Conflict.
4. Share dialog. The owner enters a registered account's email, selects VIEWER or EDITOR, changes or revokes a grant, and creates, copies or revokes a public link. Do not send email automatically.
5. Version history. List up to 20 recent retained versions. Open older versions read-only. Save as new document forks a version. Restoring over an existing version is outside the MVP.
6. Public viewer. Open a link without login in read-only mode. Do not expose owner email, folder path or ACL. Invalid, expired and revoked links all return 404.
7. Export jobs. Show queued, running, succeeded, failed or cancelled. Downloading results still checks current permissions.

## Permissions

| Action                            | Owner | Editor | Viewer | Public link |
| --------------------------------- | ----- | ------ | ------ | ----------- |
| Read content                      | Yes   | Yes    | Yes    | Yes         |
| Edit and commit content           | Yes   | Yes    | No     | No          |
| Rename or move the original       | Yes   | No     | No     | No          |
| Trash or restore                  | Yes   | No     | No     | No          |
| Manage grants and links           | Yes   | No     | No     | No          |
| Download native/TXT in the client | Yes   | Yes    | Yes    | Yes         |
| Create a server export job        | Yes   | Yes    | Yes    | No          |
| View the owner's folders          | Yes   | No     | No     | No          |

The owner is documents.owner_user_id, not an EDITOR grant. Ownership transfer is outside the MVP. Only the owner accesses folders. Read access lets the recipient save a copy of the content; revocation cannot recall already downloaded data.

## User stories and acceptance criteria

| ID  | User story                        | Acceptance criteria                                                                                                 |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| F01 | Sign in again after closing a tab | A valid refresh issues a new token; reuse of a consumed refresh is rejected and revokes its family                  |
| F02 | Organize files in folders         | Create and move correctly; prevent cycles; reject depth 21; another owner's folder returns 404                      |
| F03 | Write and reopen                  | Preserve text, B/I/U, basic font/size/color/alignment, Unicode and EOL preference across save/load                  |
| F04 | Save while continuing to type     | Save snapshot R; edits at R+1 remain Unsaved; do not falsely display Saved                                          |
| F05 | Two people edit the same document | One commit wins; the stale base receives 409; preserve the losing draft                                             |
| F06 | Share as VIEWER                   | The recipient opens through Shared with me and cannot save through UI or API                                        |
| F07 | Share as EDITOR                   | Saving creates a new version with the editor as createdBy; forbid renaming, moving or sharing the original          |
| F08 | Revoke a permission               | Reject new read authorization requests and new commits; an issued GET URL may remain valid for up to 60 seconds     |
| F09 | Use a public link                 | Read without login; keep tokens out of logs; revocation and expiry block new requests                               |
| F10 | Open a large file                 | Support 10 MiB and one million lines after the benchmark gate; reject an operation that exceeds limits in full      |
| F11 | Lose the network                  | Show Offline and keep the draft in IndexedDB; check the head before reconnect saves; do not overwrite automatically |
| F12 | Delete accidentally               | Retain trash for 14 days; temporarily disable grants and links; restoration preserves grants and unexpired links    |
| F13 | Export in the background          | Retries do not publish multiple results; escape HTML text; TXT contains no fake formatting                          |

## Conflicts and revoked access

Conflict offers Open latest, Save my changes as a new document, Download my draft and Cancel. Open latest replaces state only after the draft has been checkpointed or the user confirms discarding changes. Never automatically adopt a new head as the base for the same old snapshot.

If edit access is revoked, the next save reports the loss of permission, preserves the draft and switches the editor to read-only. Users can download the content already held or save a new copy under their own account. The MVP has no immediate push revocation. Check access on focus, every 30 seconds while the document is open, and before every save.

Cloud autosave uses a 5-second debounce, at least 15 seconds between automatic saves, and a maximum of 60 seconds during continuous editing. Pause autosave when offline, in conflict or without permission. Manual Save bypasses the debounce but uses the same save queue.

## Lab limits

Proposed limits: 10 test accounts, 100 documents per account, 100 folders per account, 20 versions per document, and 5 queued or running jobs per account. Record configuration in the environment and test atomic server enforcement. Document titles allow at most 200 code points; folder names allow 120. Apply Unicode NFC to names only, not document content. Duplicate document titles are allowed. Sibling folder names must be unique after normalization and case-insensitive, accent-sensitive comparison.

# Account collaboration extension (ADR027)

Account owners/editors may opt into **Cùng chỉnh sửa** for a document. All participants explicitly join the same room. Concurrent text and supported formatting edits merge with CRDT identities, and undo affects the caller's local actions. Read-only public links remain outside collaboration. Current limits and pending cloud/recovery work are recorded in `contracts/collaboration.md` and the sole status checkpoint.

## Subscription extension (ADR028)

The Payment service adds Free, Pro monthly and Pro yearly catalog entries with server-configured Stripe recurring Prices, hosted Checkout/Portal and period-end cancellation. Current features/quotas remain available on Free until plan-specific benefits are agreed. A return redirect cannot activate paid access; verified current subscription/invoice state and completed entitlement orchestration drive the account plan. Only sandbox credentials/events are enabled at this checkpoint. Real Stripe acceptance remains pending configuration; see `docs/STRIPE_SETUP.md`.

## Account preferences and DOCX import — 10 October 2026

Settings is available in the account menu on desktop/mobile. Save English/Vietnamese and light/dark/system appearance separately for each account in local browser storage, with session fallback when storage is unavailable. System appearance follows live browser colour-scheme changes. Settings must not remount the editor or change document bytes/history. These preferences do not sync across devices. The legacy language cookie still localizes anonymous/server HTML; an authenticated account's saved language takes precedence.

Use consistent native select styling, including the actual popup where the browser supports customizable selects, with accessible native fallback. The subscription dialog has a Free feature list, a prominent Pro panel, selectable monthly/yearly billing and a clear hosted checkout action. Do not invent prices, savings or paid-exclusive capabilities; prices are displayed by Stripe before payment and existing editing/export capabilities remain on Free under ADR028.

Accept DOCX from New → Import and the editor File menu. Convert bounded inert OOXML directly into the canonical model, preserving supported text, rich character styles, headings, simple list/paragraph/table/image structure, header/footer and page number fields. Confirm before replacing existing contents. Reject unsupported document structures instead of silently losing their content. ZIP/XML/media/native limits apply before a model switch; save/reopen and actual DOCX/PDF exports must preserve the imported supported content. DOCX import is a bounded extension to the original MVP; arbitrary Word-layout equivalence is not promised.

## Introduction and local editing extension — 10 October 2026

The owner's Markdown/code/JSON/local-site request adds `/intro` and `/local` alongside the authenticated workspace. Local editing requires no account and never uploads file content. Ship the same introduction/editor as an independently buildable static HTTP site. Local files persist only through explicit downloads; warn before leaving modified work. Preserve each mode's content/history when changing modes, language or theme. Local theme preferences are separate from account settings.

Document mode reuses the canonical editor and its actual Worker, native codec and bounded DOCX importer. Browser-side DOCX export preserves supported rich text/list/table/image/page metadata; HTML downloads and browser Print / Save PDF run locally. The workspace's authenticated save/share/export behavior stays intact. Markdown supports source/split/preview, toolbar formatting, GFM tables/checklists and highlighted code fences. Preview raw HTML stays inert, unsafe link protocols are removed and remote media is not fetched. Code mode has syntax colors, line numbers, indentation, plain fallback and local files. JSON validation/pretty/minified output preserves raw numeric tokens, strings, duplicate keys and order, with localized line/column errors and unchanged source on failure. Source/JSON output, depth/token and Markdown preview bounds prevent uncontrolled rendering.
