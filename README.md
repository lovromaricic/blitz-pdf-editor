# Blitz PDF Editor

A free PDF editor that runs entirely in the browser. Files are never uploaded and nothing is stored.

> The product name lives only in `src/config.ts` (`APP_NAME`), pending a domain/trademark check.

Design and contribution rules (tokens only, bundled font, no network requests, reuse of `Toolbar` etc.) are in [CLAUDE.md](CLAUDE.md).

## Requirements

- Node.js 20.19+, 22.12+ or 24+ (LTS recommended)
- npm 10+

`.npmrc` sets `legacy-peer-deps=true` to work around an npm 10 peer-resolution crash with Vitest 5's optional peers. All real peers are listed explicitly in `package.json`.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run check` | Type-check TypeScript and Svelte |
| `npm test` | Run unit tests (Vitest) |
| `npm run e2e` | Run browser tests (Playwright, in the installed Google Chrome; starts its own dev server on port 5199) |
| `npm run build` | Build the static site into `dist/` |
| `npm run preview` | Serve `dist/` locally to check the build |

## Deploying

The build is a plain static folder. There is no server code.

1. `npm run build`
2. Upload **the contents of** `dist/` to your web host (FTP, SFTP, control panel file manager, `rsync`, etc.).
3. Serve over HTTPS.

### Subfolder hosting

By default the build uses relative asset paths (`base: './'`), so `dist/` works from the domain root **or** any subfolder without changes.

If you need absolute paths (for example behind a CDN that rewrites URLs), set `BASE_PATH` at build time:

```bash
BASE_PATH=/tools/pdf/ npm run build
```

### What's in `dist/`

- `THIRD_PARTY_LICENSES.txt`: license texts of every library shipped in the app, generated at build time by `build-tools/licenses.ts` (also shown in *Help › About*). Keep it with the app; Apache-2.0 and MIT require it.
- `index.html` and `assets/`: the app. The landing screen's 3D background (Three.js r128, about 128 KB gzipped) is a separate chunk loaded after the page appears; the screen works without it (and without WebGL). Fonts load only when needed: Noto (about 2.2 MB) for stamps and saving; the 15 text fonts (53 files, about 16 MB in all, typically 130–330 KB per style) one family at a time when chosen. The PDF viewer (PDF.js) is a separate chunk loaded in the background after the Home screen appears. The PDF writer (pdf-lib, in a Web Worker) loads the first time you save, extract or split.
- `pdfjs/`: data PDF.js fetches only when a document needs it (CJK character maps, the 14 standard fonts, image-decoder WASM, colour profiles). Copied from `pdfjs-dist` at build time by `build-tools/pdfjs-assets.ts`. Upload it with everything else.
- `tesseract/`: the text-recognition (OCR) engine, its worker and the English and Croatian language data (about 7 MB in total). Loaded only when someone runs *Make text searchable*, never from a CDN, and never cached in browser storage. Also copied by `build-tools/pdfjs-assets.ts`.

### Server headers

- No special headers (CORS, cross-origin isolation) are needed.
- Password protection uses pdf-lib's built-in AES-256 encryption, so no qpdf/WASM build is needed.
- `.mjs` files must be served as JavaScript (`text/javascript`) and `.wasm` files (PDF.js image decoders) as `application/wasm`. Most hosts already do. The OCR language files are `.traineddata.gz` and must be served as-is (not re-compressed or decompressed by the server). On Apache, add to `.htaccess`:
  ```
  AddType application/wasm .wasm
  AddType text/javascript .mjs
  ```

## Project structure

```
src/
  config.ts              App name and undecided copy placeholders
  main.ts                Entry point
  App.svelte             Switches between Home and Editor (lazy-loaded)
  lib/
    commands.ts          Command registry: every action has one id, used by menus and shortcuts
    actions.svelte.ts    Feature implementations (rotate, delete, insert, merge, extract, split, save)
    document.svelte.ts   Open document: pages are references into source PDFs
    history.svelte.ts    Undo/redo and unsaved-changes tracking
    page-ops.ts          Pure page-list operations, page ranges, crop margins
    layout.ts            Page layout for continuous / single / two-page views
    print.ts             Print (pages rendered to images) and plain-text export
    viewer.svelte.ts     Zoom, layout, scrolling, navigation
    search.svelte.ts     Full-text search
    ocr.ts               Text recognition (Tesseract, on this device) for scanned pages
    redact.ts            Redaction: renders marked pages with black boxes (see redactSource in pdf/assemble.ts)
    compare.ts           Compare two PDFs (word diff in compare-worker.ts / compare-diff.ts)
    open-files.svelte.ts The single "open PDFs" entry point (Home + File > Open)
    pdf/                 PDF.js setup and rendering; assemble.ts + pdf-worker.ts write PDFs (pdf-lib)
  screens/               Home.svelte, Editor.svelte
  editor/                Editor parts: title bar, menu bar, toolbar, thumbnails, canvas, panel
  editor/panels/         Right-panel content (desktop) / bottom-sheet content (phones)
  editor/mobile/         Phone layout (< 720px): top bar, accordion menu, tool strip, Pages sheet
  editor/compare/        The full-screen Compare view
  components/            Shared UI (dialogs, context menu)
  styles/tokens.css      Design tokens ("Mist"): every color, radius, shadow, font. Restyle (or add a dark theme) here.
build-tools/             Vite plugins: PDF.js runtime assets, third-party license file
tests/                   Vitest unit tests (tests/tmp/ is a gitignored scratch area for sample PDFs)
```

## How saving works

- Pages are kept as references into the original files, so editing is instant and undoable.
- **Save** rebuilds the PDF from the first page's original file, keeping its metadata, bookmarks and form fields. Deleted pages are emptied and unreferenced data is dropped, so deleted content does not stay hidden in the file.
- **Markup** (highlight, drawing, shapes, text, stamps, comments, signatures) is saved as standard PDF annotations with their own appearance, so other viewers show it identically and editors like Acrobat can still change it.
- **Text** uses one of 15 bundled open-source fonts (SIL OFL; see `THIRD_PARTY_LICENSES.md`) with bold and italic where the font has them. Each font file is fetched from the app's own server only when the font is chosen or hovered in the picker; the picker shows names using drawn previews made at build time (`build-tools/font-previews.ts`). The chosen font is embedded as a subset of the characters used. Text boxes are saved as editable annotations and also as invisible page text underneath, so search, selection and copying work in every viewer.
- **My computer's fonts…** (Chrome and Edge on desktop, secure pages): lists installed fonts after the browser asks permission. A chosen font is checked for its embedding permission (OS/2 fsType); fonts that forbid embedding, allow only bitmap embedding or forbid subsetting are refused with a message. Fonts from collections (.ttc) are extracted to a single font. They're used only in the current tab, never uploaded or stored. The item is hidden in other browsers.
- **Stamps, page numbers, watermarks and form values** use embedded Noto fonts (subset to the characters used), so č, ć, đ, Greek and Cyrillic work. Noto also backs text from before the font picker, and is the fallback if a font can't be loaded. Form values that fit the standard fonts keep using Helvetica.
- **Fill form** writes the typed values into the form fields. **Flatten / lock form…** (after a confirmation) turns the fields into page content: one undoable step, and the next Save offers a new copy named `<name>-flattened.pdf`, never the original name. Fields that only have a value (filled in by another app, no drawn appearance) get one drawn first, with Noto when the text needs it (č, ć, đ…), so no value is lost. On a PDF without fields it only says so.
- **Insert image…** (Page menu; also drag an image file onto a page, or paste one with Ctrl/Cmd+V) places JPG, PNG, WebP and, where the browser decodes it (Safari), HEIC images on the current page as movable objects: move, resize (aspect lock, Alt from the center), rotate (Shift: 15° steps), flip, opacity, bring to front / send to back, all undoable. JPEG and PNG are embedded byte for byte (no re-encoding, PNG transparency kept); a JPEG's EXIF orientation is applied by the drawing matrix, not by re-encoding. WebP and HEIC are converted through a canvas (PNG when transparent, else JPEG at 92%). Images longer than 8000 px on a side are reduced to 4096 px, with a message. The same image used several times is embedded once. Objects on a page are drawn and saved in their stacking order: an image becomes part of the page content, unless it overlaps an object below it that is saved as an annotation, in which case it is saved as an image annotation so the order holds in every viewer. Images are kept in memory for the tab only.
- **Signatures** are pictures of a signature (drawn, typed or uploaded), not certificate-based digital signatures. They are kept only in memory for the current tab.
- **Watermark and page numbers** are drawn into the page content when saving (they follow the page order).
- **Protect with password** encrypts with AES-256. A file opened with a password is saved with the same password unless *Remove password* is used.
- **Compress** re-encodes photos (JPEG and plain RGB/grey images) in the worker; text, drawings and fonts are copied unchanged, then unused objects are dropped. Presets: Light (quality 85%, at most 300 DPI), Balanced (70%, 150 DPI), Maximum (50%, 96 DPI), or Custom (quality 10–95%, Original/300/200/150/96/72 DPI). DPI is measured where each image is actually drawn on the page. The size shown for each option is a real estimate: the images are re-encoded with those settings in the worker (a sample of 24 for files with many images) and added to the size of everything else. If the result would be less than 5% smaller, the document is left unchanged and the panel says the file can't be made much smaller. Alpha masks, CMYK and special image formats are left untouched. Cancellable, and undoable: the original bytes stay in memory.
- **New blank PDF…** (File menu) builds empty pages (A4, US Letter, A5, Legal or a custom size from 36 to 14400 pt, 1–200 pages) with pdf-lib in the worker and opens them as `Untitled.pdf`, with no unsaved changes and an empty undo history. The last choices are remembered for the tab only.
- **Images to PDF** embeds JPEGs unchanged; other formats and rotated phone photos are normalized in the browser first.
- **Crop** sets each page's crop box. The trimmed area is hidden, not removed (use Tools › Redact content to remove content for good).
- **Extract** and **Split** write fresh PDFs that contain only the chosen pages.
- **Make text searchable (OCR)** recognizes scanned pages with Tesseract (English, Croatian) in a Web Worker and adds the words as invisible text over the scan, so search, selection and copying work while the pages look the same. Undoable.
- **Redact** marks areas (drag on the page, or *Mark all matches* of a word). *Apply* renders each marked page to an image (200 dpi) with black boxes and replaces the page's content with it: text, images, vector art, annotations and form fields on that page, the page thumbnail and the tagged-text structure are removed, and unreachable objects are dropped. Page size, rotation and markup made in the editor stay. Optionally the document properties (title, author, XMP metadata) are removed too. Undoable until you save; saving with marks that aren't applied asks first. Redacted pages are images, so run OCR afterwards if they need to be searchable. Bookmarks are not changed.
- **Compare two PDFs** compares the words of the open document (as edited) with another file, side by side with synced scrolling and a list of changes. It compares text, not images or layout; scans need OCR first.

## Testing on a phone

Run the dev server on your network and open the printed address on the phone (same Wi-Fi):

```bash
npm run dev -- --host
```

Under 720px wide the editor switches to the phone layout. Two fingers pinch-zoom and pan in every tool; one finger scrolls with Select and Fill form, and draws or highlights with the markup tools.

## Keyboard and accessibility

- Every action is reachable by keyboard. The full list is in *Help › Keyboard shortcuts* (generated from the command registry). Single-key tool shortcuts: V Select, T Text, H Highlight, D Draw, S Shapes, P Stamp, C Comment, G Sign, F Fill form; `?` shows all shortcuts.
- Landmarks, a "Skip to document" link, labelled controls, ARIA menu/toolbar patterns with arrow-key navigation, focus moves into tool panels when they open, and page changes are announced politely.
- PDF form fields get an accessible name from the PDF's description, or from the field name when the PDF has none.
- Respects *reduce motion* and Windows High Contrast (forced colors).
- Checked with axe-core on Home, the editor, every tool panel and dialog, and the phone layout.

## Errors and limits

- Not a PDF, empty, damaged and password-protected files are explained when opening; partial damage shows per page.
- Very large files (over ~500 MB, or ~120 MB on phones and low-memory devices) ask before opening.
- XFA forms and digitally signed PDFs show a warning (editing invalidates a signature).
- Failures while saving say what happened in plain language and stay on screen until dismissed. Unexpected errors anywhere are shown, never silently swallowed.
- Ctrl/⌘+W is reserved by browsers and closes the tab; the unsaved-changes prompt still protects your work.
