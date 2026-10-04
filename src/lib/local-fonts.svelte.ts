// "My computer's fonts": the Local Font Access API (Chrome and Edge on
// desktop, secure pages only). Chosen fonts are kept in memory for this
// session: their files become blob: URLs that the screen and the PDF worker
// use; nothing is uploaded or stored.
import { registerLocalFonts, type FontInfo } from './font-catalog';
import { cssFamily, FONT_URLS, markFamilyLoaded } from './fonts';
import { faceKey } from './font-catalog';
import { embeddingAllowed, extractFont, fontFacts } from './sfnt';

/** What the browser gives us for each installed font face. */
export interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

export function localFontsSupported(): boolean {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window && window.isSecureContext;
}

/** Local fonts chosen this session, for the picker's "My computer" group. */
export const localFonts = $state<{ list: FontInfo[] }>({ list: [] });

export class LocalFontsError extends Error {}

/** Ask permission and list installed font families (sorted, with their faces). */
export async function queryFamilies(): Promise<Map<string, LocalFontData[]>> {
  let all: LocalFontData[];
  try {
    all = await (window as unknown as { queryLocalFonts(): Promise<LocalFontData[]> }).queryLocalFonts();
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      throw new LocalFontsError("Permission to use your computer's fonts wasn't given. The bundled fonts still work.");
    }
    throw new LocalFontsError("Your computer's fonts couldn't be listed. The bundled fonts still work.");
  }
  const families = new Map<string, LocalFontData[]>();
  for (const f of all.sort((a, b) => a.family.localeCompare(b.family))) {
    families.set(f.family, [...(families.get(f.family) ?? []), f]);
  }
  return families;
}

type Style = { bold: boolean; italic: boolean };

function styleOf(style: string): Style | null {
  const s = style.toLowerCase().replace(/[-_]/g, ' ').trim();
  if (/^(regular|roman|book|normal|plain)$/.test(s)) return { bold: false, italic: false };
  if (/^bold$/.test(s)) return { bold: true, italic: false };
  if (/^(italic|oblique|regular italic|book italic)$/.test(s)) return { bold: false, italic: true };
  if (/^bold (italic|oblique)$/.test(s)) return { bold: true, italic: true };
  return null;
}

const REFUSED: Record<string, string> = {
  restricted: "doesn't allow embedding in documents",
  'bitmap-only': 'only allows embedding as pictures',
  'no-subsetting': "doesn't allow embedding just the letters used",
};

/**
 * Prepare a family for use: read each face, check its embedding permission,
 * register it on screen and for the PDF writer. Returns the font id, or a
 * message saying why it can't be used.
 */
export async function useLocalFamily(family: string, faces: LocalFontData[]): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const byStyle = new Map<string, LocalFontData>();
  for (const f of faces) {
    const s = styleOf(f.style);
    if (s && !byStyle.has(`${s.bold}-${s.italic}`)) byStyle.set(`${s.bold}-${s.italic}`, f);
  }
  // A family without a "Regular" (e.g. only "Light", "Medium"…) uses its first face as regular.
  if (!byStyle.has('false-false')) byStyle.set('false-false', faces[0]);

  const loaded: { style: Style; bytes: Uint8Array; facts: ReturnType<typeof fontFacts> }[] = [];
  for (const [key, face] of byStyle) {
    const [bold, italic] = key.split('-').map((v) => v === 'true');
    const raw = new Uint8Array(await (await face.blob()).arrayBuffer());
    const bytes = extractFont(raw, face.postscriptName);
    const facts = fontFacts(bytes);
    const verdict = embeddingAllowed(facts.fsType);
    if (!verdict.ok) {
      // Without the regular face the family can't be used at all; other styles are just skipped.
      if (!bold && !italic) return { ok: false, message: `"${family}" ${REFUSED[verdict.reason]}, so it can't be used in PDFs. Choose another font.` };
      continue;
    }
    loaded.push({ style: { bold, italic }, bytes, facts });
  }

  const regular = loaded.find((l) => !l.style.bold && !l.style.italic)!;
  const id = `local:${regular.facts.postscriptName ?? family}`;
  const info: FontInfo = {
    id,
    label: family,
    group: 'My computer',
    bold: loaded.some((l) => l.style.bold && !l.style.italic),
    italic: loaded.some((l) => l.style.italic && !l.style.bold),
    metrics: [regular.facts.ascent, regular.facts.descent],
  };
  registerLocalFonts([info]);

  try {
    const faces2 = loaded.map(
      (l) =>
        new FontFace(cssFamily(id), l.bytes as Uint8Array<ArrayBuffer>, { weight: l.style.bold ? '700' : '400', style: l.style.italic ? 'italic' : 'normal' }),
    );
    await Promise.all(faces2.map((f) => f.load()));
    for (const f of faces2) document.fonts.add(f);
  } catch {
    return { ok: false, message: `"${family}" couldn't be loaded. Choose another font.` };
  }
  for (const l of loaded) {
    // Only styles the family really has; bold italic needs both flags in the catalog entry.
    if (l.style.bold && l.style.italic && !(info.bold && info.italic)) continue;
    FONT_URLS[faceKey(id, l.style.bold, l.style.italic)] = URL.createObjectURL(new Blob([l.bytes as Uint8Array<ArrayBuffer>], { type: 'font/ttf' }));
  }
  markFamilyLoaded(id);
  if (!localFonts.list.some((f) => f.id === id)) localFonts.list = [...localFonts.list, info];
  return { ok: true, id };
}
