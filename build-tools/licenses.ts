// Collects the licenses of every package that ends up in the shipped app
// (runtime dependencies and their dependencies, plus the Svelte runtime) into
// THIRD_PARTY_LICENSES.txt, and exposes a summary as `virtual:licenses`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

interface Pkg {
  name: string;
  version: string;
  license: string;
  texts: string[];
}

const ROOT = resolve('.');
// Bundled into the app even though it's a dev dependency (it's a compiler with a runtime).
const EXTRA_ROOTS = ['svelte'];

function findPackageDir(name: string, from: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function collect(): Pkg[] {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const queue: [string, string][] = [...Object.keys(rootPkg.dependencies ?? {}), ...EXTRA_ROOTS].map((n) => [n, ROOT]);
  const seen = new Map<string, Pkg>();
  while (queue.length) {
    const [name, from] = queue.shift()!;
    const dir = findPackageDir(name, from);
    if (!dir) continue;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    const texts = readdirSync(dir)
      .filter((f) => /^(licen[cs]e|copying|notice)/i.test(f))
      .map((f) => readFileSync(join(dir, f), 'utf8').trim());
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
    seen.set(key, { name: pkg.name, version: pkg.version, license, texts });
    // Svelte's own dependencies are compile-time only.
    if (pkg.name === 'svelte') continue;
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push([dep, dir]);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function render(pkgs: Pkg[]) {
  const header =
    'Third-party software included in this application.\n' +
    'PDF.js also ships image decoders whose licenses are in pdfjs/wasm/ (OpenJPEG: BSD-2-Clause,\n' +
    'PDFium JBIG2: BSD-3-Clause, qcms: MIT) and a colour profile in pdfjs/iccs/ (CC0).\n';
  const body = pkgs
    .map((p) => `${'='.repeat(72)}\n${p.name} ${p.version} (${p.license})\n${'='.repeat(72)}\n\n${p.texts.join('\n\n') || '(no license file in package)'}\n`)
    .join('\n');
  return `${header}\n${body}`;
}

export function licenses(): Plugin {
  const VIRTUAL = 'virtual:licenses';
  const RESOLVED = '\0' + VIRTUAL;
  return {
    name: 'third-party-licenses',
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      const list = collect().map(({ name, version, license }) => ({ name, version, license }));
      return `export default ${JSON.stringify(list)};`;
    },
    configureServer(server) {
      server.middlewares.use('/THIRD_PARTY_LICENSES.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(render(collect()));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: render(collect()) });
    },
  };
}
