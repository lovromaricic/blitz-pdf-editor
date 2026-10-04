# Blitz PDF Editor

A free PDF editor that runs entirely in the browser. Files are never uploaded and nothing is stored.

> The product name lives only in `src/config.ts` (`APP_NAME`), pending a domain/trademark check.

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

- `index.html` and `assets/`: the app. The PDF engine (PDF.js) is a separate chunk loaded in the background after the Home screen appears.
- `pdfjs/`: data PDF.js fetches only when a document needs it (CJK character maps, the 14 standard fonts, image-decoder WASM, colour profiles). Copied from `pdfjs-dist` at build time by `build-tools/pdfjs-assets.ts`. Upload it with everything else.

### Server headers

- No special headers (CORS, cross-origin isolation) are needed.
- `.mjs` files must be served as JavaScript (`text/javascript`) and `.wasm` files as `application/wasm`. Most hosts already do. On Apache, add to `.htaccess`:
  ```
  AddType application/wasm .wasm
  AddType text/javascript .mjs
  ```
  This section will be updated if any library needs further headers (e.g. cross-origin isolation).

## Project structure

```
src/
  config.ts              App name and undecided copy placeholders
  main.ts                Entry point
  App.svelte             Switches between Home and Editor (lazy-loaded)
  lib/
    commands.ts          Command registry: every action has one id, used by menus and shortcuts
    document.svelte.ts   Open document: pages are references into source PDFs
    viewer.svelte.ts     Zoom, layout, scrolling, navigation
    search.svelte.ts     Full-text search
    open-files.svelte.ts The single "open PDFs" entry point (Home + File > Open)
    pdf/                 PDF.js setup and page rendering
  screens/               Home.svelte, Editor.svelte
  editor/                Editor parts: title bar, menu bar, toolbar, thumbnails, canvas, panel
  components/            Shared UI (password dialog)
  styles/tokens.css      Design tokens (colors, spacing, radii). Restyle here.
build-tools/             Vite plugin that ships PDF.js runtime assets
tests/                   Vitest unit tests (tests/tmp/ is a gitignored scratch area for sample PDFs)
```
