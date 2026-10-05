# Editing a PDF's original content: Phase 0 research

Goal: let the user select a text block or an image that is part of an opened
PDF, delete it for real (not cover it), and later turn a text block into one of
our own text boxes. This note records what was tried, what was measured and
what is recommended.

Everything below can be reproduced:

- Fixtures: `node build-tools/content-fixtures.ts` regenerates `test-fixtures/content/` (see its `manifest.json`).
- Our approach and PDF.js: `CONTENT_RESEARCH=1 npx vitest run tests/content-research.test.ts` writes `docs/research/content-edit-results.json`.
- Block counts on every fixture are also asserted in the normal unit tests (`tests/content-stream.test.ts`).
- PDFium was evaluated with a scratch script (not committed: it isn't a dependency).

## Test set (17 files, all generated here, so they may stay in the repo)

| File | Made with | What it exercises |
|---|---|---|
| chrome-article | Google Chrome print-to-PDF (Skia), tagged | subset CID TrueType fonts, an image, centred and right-aligned lines, structure tree |
| chrome-croatian-subset | Chrome | Croatian letters (čćžšđ ČĆŽŠĐ), Arimo + Tinos subsets, bold words inside a paragraph |
| chrome-columns | Chrome | two columns (reading order) |
| chrome-table-list | Chrome | a table, a bulleted list, justified text, superscripts, a footnote |
| bank-form-hr | Chrome layout + pdf-lib fields | a fictional Croatian bank form ("Banka Primjer d.d."), AcroForm fields |
| long-100-pages | Chrome | 100 pages, ~174,000 text operations (performance) |
| scanned | pdf-lib | one JPEG covering the page, no text |
| rotated-pages | pdf-lib | /Rotate 90, 180, 270; standard-14 fonts |
| rotated-text | pdf-lib | text turned 30° and 90° |
| text-outlines | pdf-lib | text drawn as shapes |
| type3-font | hand-written | a Type3 font with ToUnicode |
| form-fields | pdf-lib | text fields and a checkbox |
| signed | pdf-lib + openssl | a real adbe.pkcs7.detached signature (throwaway self-signed key) |
| incremental-update | pdf-lib + hand-written update | two revisions; the old one ("100 EUR") is still inside the file |
| encrypted-no-modify | pdf-lib (AES-256) | opens without a password; permissions forbid changes |
| tagged-actualtext | hand-written + pdf-lib | /ActualText, structure tree with /Alt, marked content, /Thumb, XMP |
| cid-subset-croatian | pdf-lib | Type0 / CIDFontType2, Identity-H, Croatian |

**Missing:** exports from Microsoft Word, Google Docs and LibreOffice. None of those apps is available on this machine, and real-world files can't go in the repo without the right to them. Chrome's output covers the same structure (subset CID fonts, one show operation per run, tagged content). Office exports add per-word positioning, tab-stop gaps, kerning arrays and more marked content. The two candidates to close the gap:

- Installing LibreOffice (MPL, used only to *make* fixtures, never shipped) would let me add a LibreOffice export and a .docx-through-LibreOffice export.
- Any Word or Google Docs file you're happy to keep in the repo can be added the same way.

## Approaches compared

| | **A. Our content-stream interpreter on pdf-lib** (prototype in `src/lib/pdf/content/`) | **B. PDF.js only** (text content + operator list) | **C. PDFium in WebAssembly** (`@embedpdf/pdfium` 2.15) |
|---|---|---|---|
| License | ours (MIT-compatible); uses pdf-lib (MIT) already in the app | Apache-2.0, already in the app | wrapper MIT; PDFium BSD-3/Apache-2.0; bundled FreeType (FTL), libjpeg-turbo, OpenJPEG, lcms2, zlib: all permissive |
| Added size | ≈25 KB minified, **10 KB gzipped** | 0 | **4.6 MB wasm (2.1 MB gzipped)** + 300 KB JS, a second PDF engine in memory next to PDF.js |
| Block detection (17 files) | **17/17 match the expected block counts**, incl. tables, superscripts, two columns, rotated text and pages | 17/17 with the same grouping applied to its text items | 13/17 with a quick adapter: it reports tight glyph bounds per object, so grouping needs separate tuning (an adapter issue, not a PDFium defect) |
| Text read correctly (vs PDF.js) | 100% character agreement on every file, Croatian included | reference | same text (via FPDFText) |
| Deleting text | removes exactly the show operations; replaces each with a same-length move (`[n] TJ`) so later text doesn't shift; every other byte of the stream is kept | **impossible**: neither the text items nor the operator list carry stream offsets, and items merge many operations (article: 20 items for 847 show operations) | `FPDFPage_RemoveObject` + `FPDFPage_GenerateContent`: works, but regenerates the whole page's content stream |
| Deleting images | removes the `Do`/inline image; drops the XObject from the page resources when unused; garbage collection removes the data | impossible (same reason) | works; unused image streams were dropped on save |
| Verified after a full-rewrite save | deleted words gone from PDF.js extraction on all 17; shown bytes found in no decoded stream; images gone and file smaller (article 39.5 → 14.4 KB, scan 41.9 → 0.9 KB); Poppler render unchanged outside the deleted area (≤ 11 pixels of anti-aliasing at the edge) | — | words gone; Poppler render unchanged when only regenerating; on the tagged file PDF.js then extracted the /ActualText instead of the visible words (marked content was rewritten) |
| Text replacement | not attempted in the PDF (per the brief): the block becomes our own text box (Phase 2), so any letter can be typed | — | `FPDFText_SetText` reuses the original subset font: letters not in the subset can't be shown |
| 100-page file | analysing all pages: **0.9 s total (≈9 ms a page)**; delete + full save: 0.11 s | text content ≈ similar, but no deletion | enumerating objects: 2.7 s |
| Failure modes | malformed content (refused, page marked "can't be edited"); fonts without widths or ToUnicode (positions approximate / text unknown: flagged); text inside a form XObject used more than once (needs copying the form first) | can't edit at all | all-or-nothing regeneration of each touched page; a second copy of the document in wasm memory; fixes for its bugs come only with new builds |

**Recommendation: A.** It's small and exact. It changes only the operations the user deleted, keeping the rest of the stream byte for byte, and it reuses what the app already has: pdf-lib for writing, the garbage collector from Redact and Compress, and PDF.js for rendering. Detection was right on every fixture. PDFium is a solid engine, but it adds 2 MB+ for a capability we can do exactly in 10 KB, and its whole-page regeneration is a bigger change to the file than needed.

## Hidden copies of deleted content, and how each is removed

Measured by deleting the visible span that carries /ActualText in `tagged-actualtext.pdf`:

- **/ActualText** (in a BDC properties dictionary): **still in the file** after a plain deletion.
  - Plan: when the text of a marked-content sequence is deleted (fully or partly), rewrite its BDC without /ActualText, /Alt and /E (an inline dictionary is rewritten in place; a named /Properties entry is copied and changed).
- **Structure tree** (/StructTreeRoot, /Alt on the element): **still in the file**.
  - Plan: remove the deleted MCIDs from their elements' /K. An element left with no content goes from its parent, its /Alt, /ActualText, /E and /T with it, and its parent-tree slot becomes null.
- **Marked content** (empty BDC … EMC pairs): left in place. They hold no text once the ActualText is gone, and removing them would risk unbalanced pairs.
- **Thumbnails** (/Thumb): removed from every edited page (they'd show the old content).
- **XMP metadata**: the fixture's description repeats the hidden text.
  - We can't know which metadata repeats page content.
  - Proposal: when content was deleted, remove the XMP packet and keep the Info dictionary (title, author, subject, keywords), and say so in the save message. Your call.
- **Old revisions** (incremental updates): **gone**. The app's save is already a full rewrite (one %%EOF), and the garbage collector drops unreachable objects.
  - Correction (Phase 1): the Phase 0 harness checked this vacuously, because pdf-lib writes text as hex strings, so "100 EUR" never appeared literally. `tests/content-edit.test.ts` now proves it properly: it inflates every stream in the raw file and decodes hex strings, finds "100 EUR" before the edit, and finds it gone after.
- **Link annotations** over a deleted block stay clickable.
  - Plan: remove links whose area lies inside deleted content.
- **Invisible OCR text** (render mode 3) under a scan:
  - Plan: deleting the scan also deletes the invisible text drawn over it, so no hidden words survive.

## What the editor will not do (proposed)

- Edit or delete content inside **annotations or form fields** (they have their own tools), **vector graphics**, **shadings** or **patterns**.
- Delete an image used as a **mask**, a **soft mask**, or inside a **pattern** or **Type3 glyph**: the app says it can't be removed cleanly.
- **Text inside a form XObject** is deletable after copying that form for the page; forms nested more than one level deep are refused with a message.
- **Vertical writing** (CJK -V encodings), text on a curve, and text whose font has no widths or no Unicode mapping: delete only, never convert to a text box (Phase 2).
- **Malformed content streams**: the page is marked "This page's content can't be edited." and nothing changes.
- **Encrypted files whose permissions forbid changes**: no editing, with a message (nothing is bypassed).
- **Signed files**: editing is allowed after a warning that the signature becomes invalid.
- **Optional content (layers) that is switched off**: not offered for selection.
- **Text that is clipped out of view**: not offered for selection.

STOP: waiting for "go" before Phase 1.
