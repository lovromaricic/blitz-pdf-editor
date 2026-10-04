// Ships the runtime assets PDF.js fetches on demand (CJK character maps, the 14
// standard fonts, image-decoder WASM, ICC profiles) under <base>/pdfjs/.
// Served straight from node_modules in dev, copied into dist/ on build.
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const ROOT = resolve('node_modules/pdfjs-dist');
const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
// The scripting engine is only used for JavaScript inside PDFs, which we never enable.
const EXCLUDE = /quickjs/;

const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.icc': 'application/vnd.iccprofile',
};

export function pdfjsAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pdfjs-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '').split('?')[0])).replace(/^([/\\])+/, '');
        const file = join(ROOT, rel);
        const [dir] = rel.split(sep);
        if (!DIRS.includes(dir) || EXCLUDE.test(rel) || !file.startsWith(ROOT + sep)) return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        const ext = file.slice(file.lastIndexOf('.'));
        res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      for (const dir of DIRS) {
        cpSync(join(ROOT, dir), join(outDir, 'pdfjs', dir), {
          recursive: true,
          filter: (src) => !EXCLUDE.test(src),
        });
      }
    },
  };
}
