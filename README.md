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
- `index.html` and `assets/`: the app. The landing screen's 3D background (Three.js r128, about 128 KB gzipped) is a separate chunk loaded after the page appears; the screen works without it (and without WebGL). Fonts load only when needed: Noto (about 2.2 MB) for stamps and saving; the 15 text fonts (53 files, about 16 MB in all, typically 130–330 KB per style) one family at a time when chosen. The PDF viewer (PDF.js) is a separate chunk loaded in the background after the Home screen appears. The PDF writer (pdf-lib, in a Web Worker) loads the first time you save, extract or split. The text editor (ProseMirror and the link popovers, about 71 KB gzipped) loads the first time a text box is edited.
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
    text-rich.ts         Rich text model of text boxes (paragraphs of runs), and the one layout entry point
    text-rich-layout.ts  The text layout engine (wrapping, line boxes, justification, link areas): editor, print and PDF share it
    font-metrics.ts      Glyph widths and underline metrics read from the bundled font files
    links.ts             Link addresses: allowed schemes, clean-up, punycode, finding a typed address
    rich-text/           The text editor's model (ProseMirror schema and commands) and in-memory clipboard
    pdf/                 PDF.js setup and rendering; assemble.ts + pdf-worker.ts write PDFs (pdf-lib)
  screens/               Home.svelte, Editor.svelte
  editor/                Editor parts: title bar, menu bar, toolbar, thumbnails, canvas, panel;
                         RichTextEditor.svelte (lazy) with LinkPopover / LinkCard for typing in text boxes
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
- **Rich text**: words in one text box can each have their own font, size, colour, bold, italic, underline, strikethrough and link (alignment, line spacing, background and opacity are per box). Typing happens in a ProseMirror editor (MIT, loaded the first time a box is edited) that lies invisibly on the box; what you see is always drawn by the app's own layout engine (`text-rich-layout.ts`), measured with the font files' own glyph widths, and the PDF is written from the very same layout, so line breaks and positions match on screen, in print and in the saved file. Kerning and ligatures are off everywhere for that reason. Paste is plain text; copying between text boxes keeps the formatting through memory only (never the system clipboard). Text boxes from before rich text keep their stored line breaks until edited.
- **Lists** are a property of a paragraph: bulleted or numbered, three levels. The shared layout engine indents each level by 1.5 em of the item's first run, with wrapped lines under the text, and draws the marker in that gutter: bullets (disc, circle, square) as small shapes, numbers (1. / a. / i.) as real text right-aligned, so the PDF stays searchable and an item copies as "1. Item". Numbering continues at a level and restarts after a plain paragraph or a bullet at that level; a sublist restarts under each new parent item; after z come aa, ab…; roman numerals go up to 3999. List items are left-aligned (justified in a justified box). Checked against PDF.js, Chrome's viewer and Apple PDFKit.
- **Links** in text boxes go to a web address (http/https), an email address (mailto), a phone number (tel) or a page of the document; nothing else is accepted (no javascript:, data: or file:). Addresses are checked and cleaned up locally (no lookups or previews), and international domain names are stored and shown in punycode. They are saved as standard Link annotations, one per line of linked text, so other viewers can click them too (checked in PDF.js, Chrome's viewer and Apple PDFKit / Preview); links to a page point at that page and follow it when pages move, and links to a deleted page are removed (undoably). Links in opened PDFs open with Ctrl/⌘+click while the Select tool is on, in a new tab without access to the app.
- **Layer order**: the objects on a page (text boxes, images, shapes, stamps, drawings, highlights, comments) share one stacking order, above the PDF's own content, which never moves. *Edit › Order*, the context menu, the panel's *Order* buttons and Ctrl/⌘+↑/↓ (one step) or Ctrl/⌘+Shift+↑/↓ (to front/back) all run the same action, one undo step each. New objects go on top; duplicates and pastes go directly above their original. The saved PDF writes the objects in that order (images that overlap nothing below them go into the page content, under every annotation), so other viewers draw them the same way: checked against PDF.js, Chrome's viewer and Apple PDFKit (Preview), transparency included. Ctrl/⌘+[ and ] aren't used: on macOS they are the browsers' Back and Forward.
- **Page boundary**: objects added in the editor never leave their page (the edge itself is fine): moving, nudging, resizing, drawing, pasting, duplicating and inserting images all stop at the page as shown (crop applied), by the object's actual extent; a text box that grows while typed in moves up, then takes no more lines ("This text box is full"). A crop that leaves objects off a page brings them back in the same undo step. The PDF's own content is never limited.
- **Guides** (View menu, editor-only, never saved or printed, reset on reload): *Show margins* (6.35, 12.7, 20 or 25 mm, default 25; at most a quarter of a small page), *Keep objects inside margins* (the margin becomes the limit for objects moved, resized, added or typed into; an object already past it is left as it is and can only move inward), and *Smart guides* (page center, other objects' edges and centers). Moving or resizing snaps within 6 screen pixels at every zoom, with a labelled guide line; Alt/Option while dragging moves freely. Snapping comes first, then the limit. Selection frames and handles are drawn inside an object's real bounds, so a frame on a margin never seems to cross it; a text box's text starts 3 pt inside its frame (its padding).
- **My computer's fonts…** (Chrome and Edge on desktop, secure pages): lists installed fonts after the browser asks permission. A chosen font is checked for its embedding permission (OS/2 fsType); fonts that forbid embedding, allow only bitmap embedding or forbid subsetting are refused with a message. Fonts from collections (.ttc) are extracted to a single font. They're used only in the current tab, never uploaded or stored. The item is hidden in other browsers.
- **Stamps, page numbers, watermarks and form values** use embedded Noto fonts (subset to the characters used), so č, ć, đ, Greek and Cyrillic work. Noto also backs text from before the font picker, and is the fallback if a font can't be loaded. Form values that fit the standard fonts keep using Helvetica.
- **Fill form** writes the typed values into the form fields. **Flatten / lock form…** (after a confirmation) turns the fields into page content: one undoable step, and the next Save offers a new copy named `<name>-flattened.pdf`, never the original name. Fields that only have a value (filled in by another app, no drawn appearance) get one drawn first, with Noto when the text needs it (č, ć, đ…), so no value is lost. On a PDF without fields it only says so.
- **Insert image…** (Page menu; also drag an image file onto a page, or paste one with Ctrl/Cmd+V) places JPG, PNG, WebP and, where the browser decodes it (Safari), HEIC images on the current page as movable objects: move, resize (aspect lock, Alt from the center), rotate (Shift: 15° steps), flip, opacity, bring to front / send to back, all undoable. JPEG and PNG are embedded byte for byte (no re-encoding, PNG transparency kept); a JPEG's EXIF orientation is applied by the drawing matrix, not by re-encoding. WebP and HEIC are converted through a canvas (PNG when transparent, else JPEG at 92%). Images longer than 8000 px on a side are reduced to 4096 px, with a message. The same image used several times is embedded once. Objects on a page are drawn and saved in their stacking order: an image becomes part of the page content, unless it overlaps an object below it that is saved as an annotation, in which case it is saved as an image annotation so the order holds in every viewer. Images are kept in memory for the tab only.
- **Crop image** (double-click an inserted image, the *Crop* button in its panel, or *Crop…* in its context menu; not for groups or several objects): the whole original shows at the object's scale and turn, the cropped-away part shaded, with a frame of 8 handles (44 px targets on touch). Handles resize the frame; dragging moves the image under it. Ratio presets (Free, Original, 1:1, 4:3, 3:2, 16:9) with Portrait/Landscape, *Reset crop*. Enter or a click outside applies (one undo step), Escape cancels; arrows move the image, Alt/Option+arrows resize. Applying keeps the visible scale and place: the object becomes the cropped area. Crops are non-destructive in the editor (the original stays in memory; crop again to bring back what was cut off) and sit on whole pixels. Every written PDF embeds only the kept pixels: cut in the image worker (main-thread fallback), EXIF orientation applied, JPEG re-encoded once as JPEG at 95% by the browser's encoder, PNG as lossless PNG with transparency, never downscaled unless the device can't hold the canvas (then it fits 16.7 MP, with a message). The same crop is embedded once; uncropped uses share the original. Print and Export as images draw only the crop. Files with no cropped images are written exactly as before. Checked against PDF.js, Poppler and Apple Quartz (within a pixel).
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
