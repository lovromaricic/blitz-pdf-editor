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
- `index.html` and `assets/`: the app. Fonts (Noto, about 2.2 MB) load only when text tools or saving need them. The PDF viewer (PDF.js) is a separate chunk loaded in the background after the Home screen appears. The PDF writer (pdf-lib, in a Web Worker) loads the first time you save, extract or split.
- `pdfjs/`: data PDF.js fetches only when a document needs it (CJK character maps, the 14 standard fonts, image-decoder WASM, colour profiles). Copied from `pdfjs-dist` at build time by `build-tools/pdfjs-assets.ts`. Upload it with everything else.

### Server headers

- No special headers (CORS, cross-origin isolation) are needed.
- Password protection uses pdf-lib's built-in AES-256 encryption, so no qpdf/WASM build is needed.
- `.mjs` files must be served as JavaScript (`text/javascript`) and `.wasm` files (PDF.js image decoders) as `application/wasm`. Most hosts already do. On Apache, add to `.htaccess`:
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
    open-files.svelte.ts The single "open PDFs" entry point (Home + File > Open)
    pdf/                 PDF.js setup and rendering; assemble.ts + pdf-worker.ts write PDFs (pdf-lib)
  screens/               Home.svelte, Editor.svelte
  editor/                Editor parts: title bar, menu bar, toolbar, thumbnails, canvas, panel
  editor/panels/         Right-panel content (desktop) / bottom-sheet content (phones)
  editor/mobile/         Phone layout (< 640px): top bar, accordion menu, tool strip, Pages sheet
  components/            Shared UI (dialogs, context menu)
  styles/tokens.css      Design tokens ("Mist"): every color, radius, shadow, font. Restyle (or add a dark theme) here.
build-tools/             Vite plugins: PDF.js runtime assets, third-party license file
tests/                   Vitest unit tests (tests/tmp/ is a gitignored scratch area for sample PDFs)
```

## How saving works

- Pages are kept as references into the original files, so editing is instant and undoable.
- **Save** rebuilds the PDF from the first page's original file, keeping its metadata, bookmarks and form fields. Deleted pages are emptied and unreferenced data is dropped, so deleted content does not stay hidden in the file.
- **Markup** (highlight, drawing, shapes, text, stamps, comments, signatures) is saved as standard PDF annotations with their own appearance, so other viewers show it identically and editors like Acrobat can still change it.
- **Text, stamps and form values** use embedded Noto fonts (subset to the characters used), so č, ć, đ, Greek and Cyrillic work. Form values that fit the standard fonts keep using Helvetica.
- **Fill form** writes the typed values into the form fields; **Flatten form** turns fields into page content on save.
- **Signatures** are pictures of a signature (drawn, typed or uploaded), not certificate-based digital signatures. They are kept only in memory for the current tab.
- **Watermark and page numbers** are drawn into the page content when saving (they follow the page order).
- **Protect with password** encrypts with AES-256. A file opened with a password is saved with the same password unless *Remove password* is used.
- **Compress** re-encodes photos (JPEG and plain RGB/grey images) at lower resolution and quality in the worker, then drops unused objects. Alpha masks, CMYK and special image formats are left untouched. It's undoable: the original bytes stay in memory.
- **Images to PDF** embeds JPEGs unchanged; other formats and rotated phone photos are normalized in the browser first.
- **Crop** sets each page's crop box. The trimmed area is hidden, not removed (true removal is what Redact, planned for later, will do).
- **Extract** and **Split** write fresh PDFs that contain only the chosen pages.
- Saving a password-protected PDF produces an unprotected copy (the app warns about this). Re-protecting is the job of *Tools › Protect with password* (Phase 6).

## Testing on a phone

Run the dev server on your network and open the printed address on the phone (same Wi-Fi):

```bash
npm run dev -- --host
```

Under 640px wide the editor switches to the phone layout. Two fingers pinch-zoom and pan in every tool; one finger scrolls with Select and Fill form, and draws or highlights with the markup tools.

## Keyboard and accessibility

- Every action is reachable by keyboard. The full list is in *Help › Keyboard shortcuts* (generated from the command registry). Single-key tool shortcuts: V Select, T Text, H Highlight, D Draw, R Shapes, K Stamp, N Comment, S Sign, F Fill form; `?` shows all shortcuts.
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
