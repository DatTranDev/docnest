# Editor core and native file design

The editor keeps canonical text and style on the main thread. A worker maintains a replica keyed by localRevision for searching and serialization. React holds UI and toolbar state, not a complete document string, and must not setState with the full text on every keystroke.

## Limits and coordinates

- Canonical UTF-8 text with LF line endings allows at most 10,485,760 bytes and 1,000,000 lines. An empty file has one line; a final LF adds an empty line.
- Offsets are UTF-16 code units, using half-open intervals [from,to). A😀B has length 4; the emoji occupies [1,3).
- Caret, deletion and style boundaries follow graphemes. Do not split surrogates, combining sequences or ZWJ sequences. Do not NFC/NFD-normalize content.
- Raw TXT imports allow at most 12 MiB. Normalize CRLF/CR to LF, then enforce canonical limits. Reject invalid UTF-8.
- Native input is limited to 32 MiB, text to 10 MiB, styles to 8 MiB, optional formatting and media entries to 8 MiB each, manifest to 64 KiB, and total uncompressed payload to 32 MiB.

## Text and style

TextAdapter wraps immutable CodeMirror Text and uses line/lineAt/slice/iterator/ChangeSet. Edit cost also depends on the leaf or line that must be rebuilt. A single 10 MiB line is a separate workload; do not claim that every edit is O(log N).

StyleTree is a persistent B+ tree with a target fanout of 16..32 and totalLength/andMask/orMask aggregates. Derive offsets from lengths. Uniform leaves cover long regions; run or dense leaves cover approximately 4096 code units. Dense leaves use three bit planes, not one object per character. Masks are 1 for bold, 2 for italic, 4 for underline, 0 for plain and 7 for all three. Merge adjacent runs with the same mask.

StyleTree API: length, maskAt, slice, replace, concat, queryRuns(from,to), applyBit(from,to,bit,mode), and a serialization iterator. Setting a format ORs its bit; clearing ANDs with (7 XOR bit). Toggle clears if the whole selection has the bit; otherwise it sets. A lazy transform is f(m)=(m AND a) OR o. Applying a new tag (b,p) after an old tag (a,o) produces (a AND b,(o AND b) OR p). Never mutate nodes shared with history.

Start with uniform/run leaves and property tests. Add dense leaves before accepting dense-style files. Select encoding by byte cost, not line count. Invariants: total style length equals text.length; masks are 0..7; every grapheme has one consistent mask. A small flat-array oracle is for tests only.

Run leaves store cumulative end offsets and three-bit masks in a Uint16Array: `(end << 3) | mask`. The maximum leaf length of4096 makes each entry fit16bits. Lookup uses binary search; clipped range queries traverse the existing tree with composed lazy masks, without splitting or rebuilding it. In-memory run/dense selection compares typed-array byte costs. The native codec independently selects its existing uniform/run/dense wire records, so the on-disk format and fixtures are unchanged.

Loading builds CodeMirror Text in4096-line batches. A per-load map shares equal short line strings, capped at4096 entries and256 UTF-16 units per string; the map is released after construction. This applies to arbitrary text, with no fixture-specific behavior or global document cache. UTF-8 byte accounting avoids temporary encoded buffers. Native serialization encodes bounded text chunks into the exact-size payload, carries surrogate pairs across chunk boundaries, and writes ZIP headers and payloads into one final buffer. Canonical immutable text/style snapshots and save revision checks remain unchanged.

## Transactions and history

Text changes, style effects, selection, byte count and token commit within one EditorState update. For multi-range edits, apply style replacements in descending offset order using coordinates from the start of the transaction. Grapheme boundaries can expand when a new combining mark joins an existing character. Use the mask of the first surviving character, or pendingMask for a completely new grapheme.

Typing at the caret uses pendingMask. Moving the caret inherits the preceding character in the same line; at the start of a line use the next character; an empty line uses its newline mask or 0. A toolbar action at the caret does not create an empty range or make content dirty. Plain paste uses pendingMask; internal paste preserves text/style slices. HTML paste is outside the MVP; do not import arbitrary HTML.

Use one custom HistoryManager, without CodeMirror history in parallel. An entry stores forward/inverse ChangeSets, before/after StyleRoots, selection, pendingMask and contentToken. Undo/redo restore them together and still increment localRevision. Group typing within 500 ms; one IME composition is one group. Paste, formatting, caret movement and replace-all end a group. A new edit after undo discards redo. Cap history at 64 MiB and 2000 groups. If one operation exceeds the cap, ask the user to reduce history or cancel; do not silently discard undo.

## Loading and viewport rendering

Load the complete model when opening a document. Render only CodeMirror visibleRanges in a container with a bounded height; wrapping is off by default. Decode streams in 64–256 KiB chunks, preserving UTF-8 and CR state across boundaries. Show a read-only preview while loading; enable editing only after validation. Do not create one million DOM lines, split the entire document on every edit, or query every style when scrolling.

The viewport plugin queries StyleTree for visibleRanges and creates Decoration.mark for masks 1..7. Use fixed CSS classes and never insert text through innerHTML. Cache by token/range/font with a total cap of 16 MiB. Track DOM line count, style-span count and long lines. Jumping to the end of a million-line file must be correct. Do not invent a spacer based on L × lineHeight without measuring layout.

## Worker and search

The protocol includes init, delta(baseRevision,revision), ACK, search, snapshot and cancel with generationId/requestId. The worker does not commit editor state. Transfer plain schemas or typed bytes, not cloned Text/StyleRoot class instances. Resynchronize if the base revision mismatches. Cap the delta queue at 4 MiB or 100 transactions; coalesce updates and prioritize catching up with state.

Use streaming KMP for literal search across chunks and newlines with cooperative cancellation. Results carry a revision; discard stale results. Retain at most 10,000 match offsets and continue counting without allocating an object for every match. The MVP supports exact and ASCII case-insensitive search. Replacement uses the mask at the match start. Replace-all is one transaction and checks limits before commit. Regex and Unicode folding are extensions.

## Snapshots and dirty state

Saving pins immutable text/style at localRevision R with contentToken R. The worker serializes exactly R even while the user edits R+1. After cloud commit, set only savedContentToken=token R; compare it with the current token to determine dirty state. Do not reset history on save. An IndexedDB checkpoint provides recovery; it does not mean the cloud is Saved.

## Native adaptive v1 format

A .tedoc file is ZIP STORE with exactly three entries: manifest.json, text.utf8 and styles.bin. The V1 encoder/decoder does not compress. Reject duplicate or unknown entries, encrypted ZIPs, symlinks and methods other than STORE. Do not extract entry names to the filesystem. Check each payload's CRC and SHA256 and enforce caps before allocating. The manifest schema is docs/contracts/native-manifest.schema.json.

## Native v2 character and paragraph formatting

Files without extended formatting remain byte-compatible V1. A document using font, size, color or alignment uses schemaVersion 2 and exactly four ZIP STORE entries: the three V1 entries plus `formatting.json`. The V2 manifest adds `formattingEncoding: "sparse-v1"` and `formattingSha256`. The new entry is UTF-8 JSON with exact keys `runs` and `paragraphs`. Runs are sorted, nonoverlapping UTF-16 half-open spans with optional font (`Arial`, `Times New Roman`, `Georgia`, `Verdana`, `Courier New`), integer size (8–72 pt), or six-digit hex color. Paragraph records have a UTF-16 line-start offset and alignment `center`, `right` or `justify`; absent records mean left alignment. There are at most 100,000 records of each kind; character boundaries must be grapheme boundaries. The entry is capped at 8 MiB. B/I/U masks and TXT export remain V1 semantics. HTML export renders these additional properties using allowlisted CSS values. Native V1 remains readable and is written for documents without extended formatting.

Replacement with up to 10,000 matches carries the extended character formatting at each match start. The streaming path for more than 10,000 matches rejects a document with extended formatting so it cannot silently erase that formatting; use smaller replace batches in that case.

## Native v3 embedded images and A4 preview

An image occupies one U+FFFC placeholder in canonical text. Its data lives in a sparse image store keyed by UTF-16 offset. Inserting, deleting, undoing and redoing text update the image positions with the same ChangeSet. PNG and JPEG are accepted, up to 2 MiB and 4096×4096 pixels per image and 100 images per document. The browser decodes a selected image before insertion; both TypeScript and Java validate the encoded signature and dimensions on native load. A V3 file has exactly five ZIP STORE entries: V2 entries plus `media.json`, with `mediaEncoding: "embedded-v1"` and its SHA-256 in the manifest. `media.json` is capped at 8 MiB and has exact shape `{ "images": [{ "from", "id", "mime", "width", "height", "data" }] }`, sorted by unique offset. The data property is canonical base64. V1/V2 remain readable and are still emitted when no images are present. TXT substitutes `[Image]` for an embedded image; HTML embeds bounded data URIs. No API, event, SQL, or storage-reference fields changed.

The toolbar opens a read-only A4 page preview. The browser flows a pinned snapshot through fixed-size CSS columns (210×297 mm at 96 CSS px/inch), preserving text formatting, paragraph alignment and images. The preview is capped at 200,000 UTF-16 units; larger documents stay in the virtualized CodeMirror editor. Pagination is a visual preview, not stored page breaks, print output or a WYSIWYG editing mode. Page count depends on browser font metrics and is not a canonical document property.

For image-bearing documents, the worker replica receives text/style/formatting but does not retain image bytes. A pinned snapshot request supplies the matching image data only while native serialization is needed; revision checks still guard snapshot consistency. The editor and A4 preview reuse per-document Blob URLs instead of embedding base64 data URLs in the DOM. URLs are revoked when the image is removed or the controller closes. This reduces persistent duplicate image payloads without changing native V3 or offline draft semantics; decoded browser bitmaps and the main-thread base64 store still consume memory.

styles.bin has a 20-byte header: ASCII TEDSTYLE (8 bytes), u16 version=1, u16 flags=0, u32 totalUtf16Length, and u32 recordCount. Fixed-width integers are little-endian. Each record covers a consecutive region:

| Tag       | Payload                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| 0 uniform | u8 tag; unsigned LEB128 length; u8 mask                                                           |
| 1 runs    | u8 tag; LEB128 coveredLength; LEB128 runCount; runCount pairs of LEB128 length and u8 mask        |
| 2 dense   | u8 tag; LEB128 length; bold/italic/underline planes, each containing ceil(length/32) u32 LE words |

Lengths are positive. Varints use at most 5 bytes and canonical shortest encoding; reject unknown tags. Run lengths sum to coveredLength; all record lengths sum to N. recordCount=0 is permitted only for N=0. Code unit j uses word floor(j/32) and bit j mod 32. Padding bits are zero, and trailing bytes are forbidden. Manifest textSha256/stylesSha256 values are lowercase hex. UTF-16 N in the manifest and header equals decoded text length. The backend validates counts, UTF-8, checksums and structure; the client also validates consistent styling within graphemes. The backend uses pinned ICU4J grapheme segmentation to enforce the same semantics. P00/P04 pin the same Unicode grapheme rules in Java and TypeScript. The frontend's pinned segmenter package is authoritative; Intl.Segmenter is a fast path only if golden tests prove equivalence. Java/JS Unicode golden tests are mandatory, including new emoji and ZWJ sequences.

text.utf8 has no BOM and uses only LF. preferredExportEol LF/CRLF and exportBom preserve import/export preferences. TXT does not preserve styles. Native files contain no folder, ACL, cloud revision, undo, DOM or tree pointers. HTML export escapes &,<,>, and quotes, uses an allowlist of tags/classes, and preserves whitespace. Server output is capped at 64 MiB. Exceeding the cap returns an error instead of truncating the document.

## Native v4 extended character formatting (ADR030)

V4 uses the five V3 ZIP STORE entry names, with `schemaVersion: 4` and `formattingEncoding: "sparse-v2"`. `media.json` is present even without images (`{"images":[]}`). Character runs may additionally contain `background` (six-digit hex color), `strike` (boolean), and `script` (`super` or `sub`, mutually exclusive in one field). Run/grapheme, record-count, SHA/CRC and 8 MiB entry/32 MiB total limits remain unchanged. Null highlight and normal baseline are editing commands that remove stored attributes. V1–V3 decoders reject these fields; their writer bytes remain unchanged when extended properties are absent. The modern reader accepts all four versions. HTML emits allowlisted background/decorations/vertical alignment; TXT preserves its existing plain-text semantics.

The toolbar includes appearance presets for Normal, Title, Subtitle and Heading 1–6. A preset applies to whole selected paragraphs in one history transaction and preserves paragraph alignment. It stores explicit existing font/size/color/B/I/U properties; it is not a structural heading tag, outline or table-of-contents marker. Clear formatting removes selected character attributes and B/I/U in one undoable transaction, preserving alignment, text and images; at a caret it resets pending typing styles. Caret-only presets on an empty paragraph also change pending styles. Font-size buttons step within the existing 8–72 pt bounds. New attributes propagate through worker snapshots, offline drafts and Yjs attributed text. Model state remains canonical and React holds only small toolbar state.

Still outside this extension: semantic headings/outline/TOC, bullets/numbering, indentation/line spacing, hyperlinks, tables, stored page breaks, headers/footers and DOCX/PDF interchange. Rich system clipboard currently transfers the existing B/I/U payload, not the new run properties; native save/copy and internal undo/history preserve them. Roll out V4-capable backend services before a V4-writing Web build; older service images cannot validate a V4 upload.

## Memory and benchmark gates

Target incremental memory relative to an empty app: steady ≤256 MiB and peak ≤512 MiB, including main thread and worker. History has a 64 MiB cap and cache 16 MiB. Allow only one large save snapshot and one search job. Track text/style nodes, leaf occupancy, run count, worker queue and retained history. Do not infer RAM usage from file bytes.

Local-file targets: complete open p95 ≤2 seconds; input p95 ≤50 ms/p99 ≤100 ms; scroll frame p95 ≤20 ms; literal search p95 ≤500 ms; native serialization p95 ≤2 seconds. Use a reference desktop with 8 GiB RAM, a recorded release browser and a 100-line viewport. Measure long lines and dense styles separately. Do not promise million-line support until the gate passes. Cloud upload time is separate from local serialization benchmarks.

# Concurrent account editing (ADR027)

Opt-in collaboration uses Yjs attributed text and image asset references. Local validated editor transactions publish incremental updates; remote updates project back into the same native text/style/format/image model. Origin-scoped CRDT undo replaces standalone snapshot history in a collaborative session. The SQL delivery cursor does not replace the CRDT identities or Document head revision. The first release caps collaborative text at 200,000 UTF-16 units to bound additional memory; standalone large-file limits stay intact. See `contracts/collaboration.md` for transport, quotas, offline journal and checkpoint behavior.

## Native V5: structured paragraphs and page settings (ADR031)

V5 keeps the same five ZIP STORE entries as V3/V4 and uses `formattingEncoding: sparse-v3`. Older versions keep their exact shape and attribute allowlists; they cannot carry V5 data. Writers choose V5 only when structural attributes, a hyperlink or nonempty page settings are present. `formatting.json` is `{runs, paragraphs, page?}`. The V5 schema is `contracts/native-formatting-v5.schema.json`; runtime validation additionally checks grapheme/paragraph offsets, safe URI syntax and bounded record counts.

Runs add optional `link` (HTTP/HTTPS/mailto, max 2,048 characters, no credentials, whitespace, controls, backslash or markup). Clearing a link uses null in editor commands and removes it from serialized runs. Link clicks in the editor require Ctrl/Cmd; public/A4 views are read-only and links use noopener/noreferrer.

Paragraphs retain required `from`/`align`, allowing left alignment when other metadata is present. Optional `list` is bullet/number; `indent` is 0–8 (18pt increments), `lineSpacing` is 1/1.15/1.5/2/2.5/3, before/after spacing is integer 0–72pt, and `pageBreak` is boolean. New paragraphs inherit list/indent/spacing, without replicating a break on each new line. Consecutive numbered paragraphs at the same indent continue numbering; intervening paragraphs/list kinds/depth changes restart at one. Indentation is visual depth, not a multilevel outline numbering definition. Sparse numbering context is cached across viewport changes.

A table cell has optional `table:{id,columns}` (safe opaque id, 1–8 columns). Consecutive paragraphs with the same table id form row-major cells. Insertion creates 1–20 rows as one text/style/metadata/history transaction. Cells share the canonical text/style stores and UTF-16 offsets. The CodeMirror block widget renders a real HTML table and commits cell inputs back through the normal validated transaction/worker/draft/CRDT path; it does not store a second document in React/DOM. Enter/Tab moves cells; cell paste flattens newlines. General text edits/pastes/imports may add/remove canonical cells; the last incomplete row is padded visually/on export. Converting selected cells to paragraphs splits the table; merged cells, nested tables, row resizing and multiline cell paragraphs are outside this version.

`page` holds optional header/footer strings (single line, max 500 UTF-16 units, valid Unicode, no controls) and pageNumbers boolean. These settings undo/save/recover with formatting. Headers/footers repeat in A4 preview and PDF/DOCX. Break-before is stored on paragraph anchors, while automatic page count depends on font metrics. This remains virtualized editing plus bounded A4 preview rather than a full paginated WYSIWYG canvas; automatic preview page count can differ from Word/PDF. No first-page/even-page variants, header rich formatting, section layout or arbitrary page sizes yet.

Yjs uses independent per-paragraph attributes and hyperlink attributes; page settings use independent keys. Empty final paragraph metadata is retained. Concurrent edits in different cells and independent properties converge without replacing the whole document; competing same-field changes follow deterministic CRDT resolution. Local undo remains selective. Worker and draft payloads carry sparse V5 metadata, with images still supplied only for pinned serialization. Sparse arrays/links/page strings are charged to the bounded undo ledger.

Structural safety bounds: each contiguous table is limited to 1,000 cells and 20,000 UTF-16 units; both native readers enforce consistent columns. Office exports additionally cap total decoded image dimensions at 16,777,216 pixels. Limits reject rather than truncate. Simultaneous edits that cross a semantic limit require the existing manual collaboration recovery/checkpoint process.

V5 links serialize a canonical URL (including ASCII internationalized hosts/percent-encoded paths); both raw and canonical lengths are bounded. A stored break in a table starts a new row-major grid fragment on the next page, preserving cell content and padding incomplete rows rather than ignoring the break. The table widgets preserve cell focus/selection for toolbar/history actions and Ctrl+B/I/U. Cell marker/indent/spacing settings render in the editor as well as exports.
