// Writes markup as standard PDF annotations (Highlight, Ink, Square, Circle,
// Line, FreeText, Stamp, Text), each with an appearance stream so every viewer
// draws it the same way and other editors can still select and change it.
import { faceKey, firstBaseline } from '../font-catalog';
import {
  beginText,
  concatTransformationMatrix,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFPage,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';
import {
  arrowHead,
  arrowSize,
  bounds,
  normRect,
  STAMP_TEXT_RATIO,
  uprightSize,
  type Annotation,
  type BoxedAnnotation,
  type TextAnnotation,
  type Rect,
  type Rgb,
} from '../annotations';

/** A font face key from font-catalog.ts faceKey(), e.g. "roboto-bold" or "sans". */
export type FontKey = string;
/** Supplies an embedded font for the document (fonts are fetched and subset on demand). */
export type FontProvider = (doc: PDFDocument, key: FontKey) => Promise<PDFFont>;

// Must match the editor's layout (fonts.ts).
const LINE_HEIGHT = 1.25;
const TEXT_PADDING = 3;
// Noto's vertical metrics (per 1 em), for stamps (text uses each font's own, font-catalog.ts).
const ASCENT = 1.069;
const DESCENT = 0.293;

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const rgb = (c: Rgb) => c.map(n).join(' ');

export async function addAnnotations(doc: PDFDocument, page: PDFPage, annots: readonly Annotation[], fonts: FontProvider) {
  for (const a of annots) {
    const ref = doc.context.register(await buildAnnotation(doc, a, fonts));
    page.node.addAnnot(ref);
    if (a.type === 'text') await addSearchableText(doc, page, a, fonts);
  }
}

/**
 * Most viewers don't search or select text inside annotations. So text boxes
 * also get the same words written invisibly (render mode 3) into the page,
 * exactly under the annotation, like OCR text: search, selection and copying
 * work everywhere, and the annotation stays editable in apps that support it.
 */
async function addSearchableText(doc: PDFDocument, page: PDFPage, a: TextAnnotation, fonts: FontProvider) {
  if (!a.lines.some((l) => l.trim())) return;
  const font = await fonts(doc, faceKey(a.font, a.bold, a.italic));
  const key = page.node.newFontDictionary('BlitzText', font.ref);
  const [w, h] = uprightSize(a);
  // Same placement a viewer uses for the appearance: its rotated box moved onto Rect.
  const rad = (a.rotate * Math.PI) / 180;
  const [ma, mb, mc, md] = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad)];
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [ma * x + mc * y, mb * x + md * y]);
  const e = a.rect[0] - Math.min(...corners.map((c) => c[0]));
  const f = a.rect[1] - Math.min(...corners.map((c) => c[1]));
  const lineH = a.size * LINE_HEIGHT;
  const first = firstBaseline(a.font, a.size, LINE_HEIGHT, TEXT_PADDING);
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    concatTransformationMatrix(ma, mb, mc, md, e, f),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(key, a.size),
  ];
  a.lines.forEach((line, i) => {
    // A trailing space keeps lines apart when the text is copied or searched.
    if (line) ops.push(setTextMatrix(1, 0, 0, 1, TEXT_PADDING, h - first - i * lineH), showText(font.encodeText(`${line} `)));
  });
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

interface Appearance {
  content: string;
  /** Appearance box; defaults to the annotation's Rect. */
  bbox?: Rect;
  matrix?: number[];
  fonts?: Record<string, PDFRef>;
  images?: Record<string, PDFRef>;
  /** Subtype and other dictionary entries. */
  entries: Record<string, unknown>;
}

async function buildAnnotation(doc: PDFDocument, a: Annotation, fonts: FontProvider) {
  const { context } = doc;
  const rect = bounds(a);
  const ap = a.type === 'highlight' || a.type === 'ink' || a.type === 'shape' ? vectorAppearance(a) : await boxedAppearance(doc, a, fonts);
  const gs = {
    Type: 'ExtGState',
    CA: a.opacity,
    ca: a.opacity,
    // Highlights darken the text under them instead of covering it.
    ...(a.type === 'highlight' ? { BM: 'Multiply' } : {}),
  };

  const stream = context.stream(ap.content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: ap.bbox ?? rect,
    ...(ap.matrix ? { Matrix: ap.matrix } : {}),
    Resources: {
      ExtGState: { GS0: gs },
      ...(ap.fonts ? { Font: ap.fonts } : {}),
      ...(ap.images ? { XObject: ap.images } : {}),
    },
  });

  const dict = context.obj({
    Type: 'Annot',
    Rect: rect,
    C: a.color,
    CA: a.opacity,
    // Print flag: annotations print like the rest of the page.
    F: 4,
    AP: { N: context.register(stream) },
  });
  dict.set(PDFName.of('NM'), PDFString.of(a.id));
  dict.set(PDFName.of('M'), PDFString.fromDate(new Date()));
  const contents = a.type === 'text' || a.type === 'note' ? a.text : a.type === 'stamp' ? a.label : '';
  dict.set(PDFName.of('Contents'), PDFHexString.fromText(contents));
  for (const [key, value] of Object.entries(ap.entries)) {
    dict.set(PDFName.of(key), typeof value === 'string' && key === 'DA' ? PDFString.of(value) : context.obj(value as never));
  }
  return dict;
}

function vectorAppearance(a: Extract<Annotation, { type: 'highlight' | 'ink' | 'shape' }>): Appearance {
  switch (a.type) {
    case 'highlight': {
      const ops = a.rects.map((r) => `${n(r[0])} ${n(r[1])} ${n(r[2] - r[0])} ${n(r[3] - r[1])} re f`).join('\n');
      return {
        content: `/GS0 gs ${rgb(a.color)} rg\n${ops}`,
        entries: {
          Subtype: 'Highlight',
          // Per rectangle: upper-left, upper-right, lower-left, lower-right.
          QuadPoints: a.rects.flatMap((r) => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]]),
        },
      };
    }
    case 'ink': {
      const paths = a.paths
        .map((p) => {
          const pts = p.length === 1 ? [p[0], p[0]] : p;
          return pts.map((pt, i) => `${n(pt[0])} ${n(pt[1])} ${i === 0 ? 'm' : 'l'}`).join(' ') + ' S';
        })
        .join('\n');
      return {
        content: `/GS0 gs ${rgb(a.color)} RG ${n(a.width)} w 1 J 1 j\n${paths}`,
        entries: { Subtype: 'Ink', InkList: a.paths.map((p) => p.flat()), BS: { W: a.width } },
      };
    }
    case 'shape':
      return shapeAppearance(a);
  }
}

function shapeAppearance(a: Extract<Annotation, { type: 'shape' }>): Appearance {
  const stroke = `/GS0 gs ${rgb(a.color)} RG ${n(a.width)} w`;
  if (a.shape === 'line' || a.shape === 'arrow') {
    let content = `${stroke} 1 J 1 j\n${n(a.from[0])} ${n(a.from[1])} m ${n(a.to[0])} ${n(a.to[1])} l S`;
    if (a.shape === 'arrow') {
      const [w1, w2] = arrowHead(a.from, a.to, arrowSize(a.width));
      content += `\n${n(w1[0])} ${n(w1[1])} m ${n(a.to[0])} ${n(a.to[1])} l ${n(w2[0])} ${n(w2[1])} l S`;
    }
    return {
      content,
      entries: {
        Subtype: 'Line',
        L: [...a.from, ...a.to],
        LE: ['None', a.shape === 'arrow' ? 'OpenArrow' : 'None'],
        BS: { W: a.width },
      },
    };
  }

  const r = normRect(a.from, a.to);
  const fill = a.fill ? ` ${rgb(a.fill)} rg` : '';
  const paint = a.fill ? 'B' : 'S';
  const path = a.shape === 'rect' ? `${n(r[0])} ${n(r[1])} ${n(r[2] - r[0])} ${n(r[3] - r[1])} re` : ellipsePath(r);
  const entries: Record<string, unknown> = { Subtype: a.shape === 'rect' ? 'Square' : 'Circle', BS: { W: a.width } };
  if (a.fill) entries.IC = a.fill;
  // The outline is centered on the shape's edge; RD tells viewers how far inside Rect it sits.
  entries.RD = [a.width / 2, a.width / 2, a.width / 2, a.width / 2];
  return { content: `${stroke}${fill}\n${path} ${paint}`, entries };
}

/**
 * Boxed annotations are drawn upright in their own [0 0 w h] box, rotated by
 * the page rotation they were made for; viewers map that box onto Rect.
 */
async function boxedAppearance(doc: PDFDocument, a: BoxedAnnotation, fonts: FontProvider): Promise<Appearance> {
  const [w, h] = uprightSize(a);
  const rad = (a.rotate * Math.PI) / 180;
  const matrix = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0].map((v) => Math.round(v * 1e6) / 1e6);
  const base = { bbox: [0, 0, w, h] as Rect, matrix };

  switch (a.type) {
    case 'text': {
      const font = await fonts(doc, faceKey(a.font, a.bold, a.italic));
      const lineH = a.size * LINE_HEIGHT;
      const first = firstBaseline(a.font, a.size, LINE_HEIGHT, TEXT_PADDING);
      const runs = a.lines
        .map((line, i) => (line ? `1 0 0 1 ${n(TEXT_PADDING)} ${n(h - first - i * lineH)} Tm ${font.encodeText(line).toString()} Tj` : ''))
        .filter(Boolean)
        .join('\n');
      return {
        ...base,
        content: `/GS0 gs ${rgb(a.color)} rg\nBT /F0 ${n(a.size)} Tf\n${runs}\nET`,
        fonts: { F0: font.ref },
        entries: {
          Subtype: 'FreeText',
          // Viewers that rebuild the appearance use DA; ours is already complete.
          DA: `/Helv ${n(a.size)} Tf ${rgb(a.color)} rg`,
          Rotate: a.rotate,
          BS: { W: 0 },
        },
      };
    }
    case 'stamp': {
      const font = await fonts(doc, 'sans-bold');
      const size = h * STAMP_TEXT_RATIO;
      const textW = font.widthOfTextAtSize(a.label, size);
      const x = (w - textW) / 2;
      const y = h / 2 - ((ASCENT - DESCENT) * size) / 2;
      const inset = Math.max(1.5, h * 0.06);
      return {
        ...base,
        content:
          `/GS0 gs ${rgb(a.color)} RG ${rgb(a.color)} rg ${n(inset)} w\n` +
          `${roundedRect(inset / 2, inset / 2, w - inset, h - inset, h * 0.15)} S\n` +
          `BT /F0 ${n(size)} Tf ${n(x)} ${n(y)} Td ${font.encodeText(a.label).toString()} Tj ET`,
        fonts: { F0: font.ref },
        entries: { Subtype: 'Stamp', Name: 'Draft' },
      };
    }
    case 'note': {
      // A speech bubble with three text lines.
      const s = w;
      return {
        ...base,
        content:
          `/GS0 gs ${rgb(a.color)} rg 0.25 0.25 0.25 RG 1 w\n` +
          `${roundedRect(1, s * 0.28, s - 2, s * 0.7, s * 0.12)} B\n` +
          `${n(s * 0.25)} ${n(s * 0.28)} m ${n(s * 0.2)} ${n(1)} l ${n(s * 0.45)} ${n(s * 0.28)} l f\n` +
          `${n(s * 0.2)} ${n(s * 0.8)} m ${n(s * 0.8)} ${n(s * 0.8)} l ${n(s * 0.2)} ${n(s * 0.63)} m ${n(s * 0.8)} ${n(s * 0.63)} l ${n(s * 0.2)} ${n(s * 0.46)} m ${n(s * 0.6)} ${n(s * 0.46)} l S`,
        entries: { Subtype: 'Text', Name: 'Comment', Open: false },
      };
    }
    case 'image': {
      const image = await doc.embedPng(a.dataUrl);
      return {
        ...base,
        content: `/GS0 gs q ${n(w)} 0 0 ${n(h)} 0 0 cm /Im0 Do Q`,
        images: { Im0: image.ref },
        entries: { Subtype: 'Stamp', Name: a.role === 'signature' ? 'Signature' : 'Image' },
      };
    }
  }
}

function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  const k = 0.5523 * r;
  const p = (a: number, b: number) => `${n(a)} ${n(b)}`;
  return [
    `${p(x + r, y)} m`,
    `${p(x + w - r, y)} l`,
    `${p(x + w - r + k, y)} ${p(x + w, y + r - k)} ${p(x + w, y + r)} c`,
    `${p(x + w, y + h - r)} l`,
    `${p(x + w, y + h - r + k)} ${p(x + w - r + k, y + h)} ${p(x + w - r, y + h)} c`,
    `${p(x + r, y + h)} l`,
    `${p(x + r - k, y + h)} ${p(x, y + h - r + k)} ${p(x, y + h - r)} c`,
    `${p(x, y + r)} l`,
    `${p(x, y + r - k)} ${p(x + r - k, y)} ${p(x + r, y)} c h`,
  ].join(' ');
}

/** Ellipse inscribed in `r`, as four Bézier curves. */
function ellipsePath([x1, y1, x2, y2]: Rect): string {
  const k = 0.5523;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2;
  const ry = (y2 - y1) / 2;
  const p = (x: number, y: number) => `${n(x)} ${n(y)}`;
  return [
    `${p(cx + rx, cy)} m`,
    `${p(cx + rx, cy + k * ry)} ${p(cx + k * rx, cy + ry)} ${p(cx, cy + ry)} c`,
    `${p(cx - k * rx, cy + ry)} ${p(cx - rx, cy + k * ry)} ${p(cx - rx, cy)} c`,
    `${p(cx - rx, cy - k * ry)} ${p(cx - k * rx, cy - ry)} ${p(cx, cy - ry)} c`,
    `${p(cx + k * rx, cy - ry)} ${p(cx + rx, cy - k * ry)} ${p(cx + rx, cy)} c h`,
  ].join(' ');
}
