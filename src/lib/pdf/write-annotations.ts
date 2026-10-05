// Writes markup as standard PDF annotations (Highlight, Ink, Square, Circle,
// Line, FreeText, Stamp, Text), each with an appearance stream so every viewer
// draws it the same way and other editors can still select and change it.
import { faceKey } from '../font-catalog';
import { FALLBACK_STRIKE_OFFSET, FALLBACK_UNDERLINE, parseFontMetrics, textWidth, type FontMetrics } from '../font-metrics';
import { layoutTextBox, type LineBox } from '../text-box-layout';
import { bubblePath, NOTE_LINE_WIDTH, NOTE_LINES, NOTE_STROKE, toPdfPath } from '../note-shape';
import {
  beginText,
  concatTransformationMatrix,
  drawObject,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  setGraphicsState,
  showText,
  TextRenderingMode,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFImage,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';
import {
  arrowHead,
  arrowSize,
  bounds,
  normRect,
  NOTE_OUTLINE,
  NOTE_SIZE,
  STAMP_TEXT_RATIO,
  uprightSize,
  type Annotation,
  type BoxedAnnotation,
  type ImageAnnotation,
  type TextAnnotation,
  type Rect,
  type Rgb,
} from '../annotations';
import { multiply, placementMatrix, type Matrix, rectsOverlap, turnMatrix, uprightImageMatrix } from '../image-geometry';
import type { ImageAsset } from '../image-store';

/** A font face key from font-catalog.ts faceKey(), e.g. "roboto-bold" or "sans". */
export type FontKey = string;
/** Supplies an embedded font for the document (fonts are fetched and subset on demand). */
export type FontProvider = ((doc: PDFDocument, key: FontKey) => Promise<PDFFont>) & {
  /** The font file itself, for measuring text exactly like the editor does. */
  bytes?: (key: FontKey) => Promise<Uint8Array>;
};

// Noto's vertical metrics (per 1 em), for stamps (text uses each font's own, font-catalog.ts).
const ASCENT = 1.069;
const DESCENT = 0.293;

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const rgb = (c: Rgb) => c.map(n).join(' ');

export async function addAnnotations(
  doc: PDFDocument,
  page: PDFPage,
  annots: readonly Annotation[],
  fonts: FontProvider,
  images: Record<string, ImageAsset> = {},
) {
  // Annotations always draw above the page content. So an inserted image becomes
  // part of the page itself, unless it overlaps something below it that is
  // written as an annotation: then it's an image annotation too, keeping the order.
  const written: Rect[] = [];
  for (const a of annots) {
    const asset = a.type === 'image' && a.imageKey ? images[a.imageKey] : undefined;
    if (a.type === 'image' && asset && !written.some((r) => rectsOverlap(r, bounds(a)))) {
      await drawImageIntoPage(doc, page, a, asset);
      continue;
    }
    const ref = doc.context.register(await buildAnnotation(doc, a, fonts, asset));
    page.node.addAnnot(ref);
    written.push(bounds(a));
    if (a.type === 'text') await addSearchableText(doc, page, a, fonts);
  }
}

/** Each image is embedded once per output file, however often it's used. */
const embedded = new WeakMap<PDFDocument, Map<ImageAsset, Promise<PDFImage>>>();

function embedImage(doc: PDFDocument, asset: ImageAsset): Promise<PDFImage> {
  let cache = embedded.get(doc);
  if (!cache) embedded.set(doc, (cache = new Map()));
  let image = cache.get(asset);
  if (!image) {
    image = asset.kind === 'jpeg' ? doc.embedJpg(asset.bytes) : doc.embedPng(asset.bytes);
    cache.set(asset, image);
  }
  return image;
}

/** Draw an inserted image into the page content (page space, so it follows rotation and crop). */
async function drawImageIntoPage(doc: PDFDocument, page: PDFPage, a: ImageAnnotation, asset: ImageAsset) {
  const image = await embedImage(doc, asset);
  const name = page.node.newXObject('BlitzImage', image.ref);
  const m = multiply(uprightImageMatrix(a, asset.orientation), placementMatrix(a)).map((v) => Math.round(v * 1e4) / 1e4 || 0) as Matrix;
  const ops: PDFOperator[] = [pushGraphicsState()];
  if (a.opacity < 1) {
    const gs = page.node.newExtGState('BlitzGS', doc.context.obj({ Type: 'ExtGState', ca: a.opacity, CA: a.opacity }));
    ops.push(setGraphicsState(gs));
  }
  ops.push(concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
  page.pushOperators(...ops);
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
  const { lines } = await textBoxLayout(a, fonts, font);
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    concatTransformationMatrix(ma, mb, mc, md, e, f),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(key, a.size),
  ];
  for (const line of lines) {
    if (!line.text) continue;
    // Placed exactly like the visible text (justified lines spaced the same), so selections line up.
    // A trailing space keeps lines apart when the text is copied or searched.
    ops.push(setTextMatrix(1, 0, 0, 1, line.x, h - line.y));
    if (line.wordSpacing) ops.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [doc.context.obj(justifiedRuns(font, line, a.size, ' '))]));
    else ops.push(showText(font.encodeText(`${line.text} `)));
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

/** Metrics from the font file, per provider and face (the editor measures with the same numbers). */
const fileMetrics = new WeakMap<FontProvider, Map<FontKey, Promise<FontMetrics | null>>>();

function metricsOf(fonts: FontProvider, key: FontKey): Promise<FontMetrics | null> {
  if (!fonts.bytes) return Promise.resolve(null);
  let perProvider = fileMetrics.get(fonts);
  if (!perProvider) fileMetrics.set(fonts, (perProvider = new Map()));
  let m = perProvider.get(key);
  if (!m) {
    m = fonts.bytes(key).then(parseFontMetrics, () => null);
    perProvider.set(key, m);
  }
  return m;
}

/** The shared text box layout, measured with the embedded font's own metrics. */
async function textBoxLayout(a: TextAnnotation, fonts: FontProvider, font: PDFFont) {
  const m = await metricsOf(fonts, faceKey(a.font, a.bold, a.italic));
  const measure = m ? (t: string) => textWidth(m, t, a.size) : (t: string) => font.widthOfTextAtSize(t, a.size);
  const deco = m ?? { underline: FALLBACK_UNDERLINE, strike: { offset: FALLBACK_STRIKE_OFFSET, thickness: FALLBACK_UNDERLINE.thickness } };
  return layoutTextBox(a, measure, deco);
}

/**
 * A justified line as a TJ array: the text split after each space between
 * words, with the extra room (in thousandths of the font size, negative =
 * further right) after each of those spaces. One string of text, so it stays
 * searchable and selectable.
 */
function justifiedRuns(font: PDFFont, line: LineBox, size: number, trailing = ''): (PDFHexString | number)[] {
  const lead = line.text.slice(0, line.indent);
  const parts = line.text.slice(line.indent).split(/(?<= )/);
  const adjust = -Math.round(((line.wordSpacing * 1000) / size) * 1000) / 1000;
  const out: (PDFHexString | number)[] = [];
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    out.push(font.encodeText((i === 0 ? lead : '') + part + (last ? trailing : '')));
    if (!last && part.endsWith(' ')) out.push(adjust);
  });
  return out;
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

async function buildAnnotation(doc: PDFDocument, a: Annotation, fonts: FontProvider, asset?: ImageAsset) {
  const { context } = doc;
  const rect = bounds(a);
  const ap = a.type === 'highlight' || a.type === 'ink' || a.type === 'shape' ? vectorAppearance(a) : await boxedAppearance(doc, a, fonts, asset);
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
async function boxedAppearance(doc: PDFDocument, a: BoxedAnnotation, fonts: FontProvider, asset?: ImageAsset): Promise<Appearance> {
  const [w, h] = uprightSize(a);
  const rad = (a.rotate * Math.PI) / 180;
  const matrix = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0].map((v) => Math.round(v * 1e6) / 1e6);
  const base = { bbox: [0, 0, w, h] as Rect, matrix };

  switch (a.type) {
    case 'text': {
      const font = await fonts(doc, faceKey(a.font, a.bold, a.italic));
      const { lines, bars } = await textBoxLayout(a, fonts, font);
      const runs = lines
        .filter((l) => l.text)
        .map((l) => {
          const at = `1 0 0 1 ${n(l.x)} ${n(h - l.y)} Tm`;
          if (!l.wordSpacing) return `${at} ${font.encodeText(l.text).toString()} Tj`;
          return `${at} [${justifiedRuns(font, l, a.size).map((p) => (typeof p === 'number' ? n(p) : p.toString())).join(' ')}] TJ`;
        })
        .join('\n');
      // Background first, then the text, then underline / strikethrough bars (top-down box → PDF y-up).
      const parts = [
        a.background ? `${rgb(a.background)} rg 0 0 ${n(w)} ${n(h)} re f` : '',
        `${rgb(a.color)} rg\nBT /F0 ${n(a.size)} Tf\n${runs}\nET`,
        bars.map((b) => `${n(b.x)} ${n(h - b.y - b.h)} ${n(b.w)} ${n(b.h)} re f`).join('\n'),
      ].filter(Boolean);
      // Drawn as one transparency group, so with opacity below 100% text and
      // background fade together (no darker text where it overlaps the fill).
      const group = doc.context.register(
        doc.context.stream(parts.join('\n'), {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, w, h],
          Group: { S: 'Transparency' },
          Resources: { Font: { F0: font.ref } },
        }),
      );
      return {
        ...base,
        content: `/GS0 gs /Tx0 Do`,
        images: { Tx0: group },
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
        // No extra border from the viewer: the appearance is the whole design.
        entries: { Subtype: 'Stamp', Name: 'Draft', Border: [0, 0, 0] },
      };
    }
    case 'note': {
      // A speech bubble with three text lines (note-shape.ts): box and tail are one
      // closed path, filled and outlined in one go, with round joins and caps.
      const k = w / NOTE_SIZE;
      const lines = NOTE_LINES.map(([x1, y, x2]) => `${n(x1 * k)} ${n(y * k)} m ${n(x2 * k)} ${n(y * k)} l`).join(' ');
      return {
        ...base,
        content:
          `/GS0 gs ${rgb(a.color)} rg ${rgb(NOTE_OUTLINE)} RG 1 J 1 j\n` +
          `${n(NOTE_STROKE * k)} w ${toPdfPath(bubblePath(), k)} B\n` +
          `${n(NOTE_LINE_WIDTH * k)} w ${lines} S`,
        // No extra border from the viewer: the appearance is the whole design.
        entries: { Subtype: 'Text', Name: 'Comment', Open: false, Border: [0, 0, 0] },
      };
    }
    case 'image': {
      if (asset) {
        // An inserted image: the original bytes, turned, flipped and faded as on screen.
        const image = await embedImage(doc, asset);
        return {
          bbox: [0, 0, w, h],
          matrix: turnMatrix(a).map((v) => Math.round(v * 1e6) / 1e6),
          content: `/GS0 gs q ${uprightImageMatrix(a, asset.orientation).map(n).join(' ')} cm /Im0 Do Q`,
          images: { Im0: image.ref },
          entries: { Subtype: 'Stamp', Name: 'Image', Border: [0, 0, 0] },
        };
      }
      const image = await doc.embedPng(a.dataUrl);
      return {
        ...base,
        content: `/GS0 gs q ${n(w)} 0 0 ${n(h)} 0 0 cm /Im0 Do Q`,
        images: { Im0: image.ref },
        entries: { Subtype: 'Stamp', Name: a.role === 'signature' ? 'Signature' : 'Image', Border: [0, 0, 0] },
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
