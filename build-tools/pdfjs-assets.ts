// Ships runtime files that libraries fetch on demand, served from our own
// origin (never a CDN):
//   pdfjs/     PDF.js character maps, standard fonts, image-decoder WASM, ICC profiles
//   tesseract/ OCR worker, LSTM engine builds and language data
// Served straight from node_modules in dev, copied into dist/ on build.
import { cpSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Published path (under the base) -> file or directory in node_modules. */
const ASSETS: Record<string, string> = {
  'pdfjs/cmaps': 'pdfjs-dist/cmaps',
  'pdfjs/standard_fonts': 'pdfjs-dist/standard_fonts',
  'pdfjs/wasm': 'pdfjs-dist/wasm',
  'pdfjs/iccs': 'pdfjs-dist/iccs',
  'tesseract/worker.min.js': 'tesseract.js/dist/worker.min.js',
  // The engine picks one of these depending on CPU features (WASM is embedded).
  'tesseract/core/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract/core/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  // Compact "best_int" models. Add a language by adding a line (and its package).
  'tesseract/lang/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'tesseract/lang/hrv.traineddata.gz': '@tesseract.js-data/hrv/4.0.0_best_int/hrv.traineddata.gz',
};

// PDF.js's scripting engine is only for JavaScript inside PDFs, which we never enable.
const EXCLUDE = /quickjs/;
const NODE_MODULES = resolve('node_modules');

const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.icc': 'application/vnd.iccprofile',
  '.gz': 'application/gzip',
};

/** Resolve a request path to a file on disk, or null if it isn't one of our assets. */
function lookup(path: string): string | null {
  for (const [published, source] of Object.entries(ASSETS)) {
    if (path === published || path.startsWith(published + '/')) {
      const file = normalize(join(NODE_MODULES, source, path.slice(published.length)));
      if (!file.startsWith(NODE_MODULES + sep) || EXCLUDE.test(file)) return null;
      return existsSync(file) && statSync(file).isFile() ? file : null;
    }
  }
  return null;
}

export function pdfjsAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'runtime-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = lookup(path);
        if (!file) return next();
        const ext = file.slice(file.lastIndexOf('.'));
        res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      for (const [published, source] of Object.entries(ASSETS)) {
        const target = join(outDir, published);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(NODE_MODULES, source), target, { recursive: true, filter: (src) => !EXCLUDE.test(src) });
      }
    },
  };
}
