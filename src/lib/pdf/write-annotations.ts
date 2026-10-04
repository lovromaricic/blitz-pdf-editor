// Writes markup as standard PDF annotations (Highlight, Ink, Square, Circle,
// Line), each with an appearance stream so every viewer draws it the same way
// and other editors can still select and change it.
import { PDFDocument, PDFHexString, PDFName, PDFPage, PDFString } from '@cantoo/pdf-lib';
import { arrowHead, arrowSize, bounds, normRect, type Annotation, type Rect, type Rgb } from '../annotations';

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const rgb = (c: Rgb) => c.map(n).join(' ');

export function addAnnotations(doc: PDFDocument, page: PDFPage, annots: readonly Annotation[]) {
  for (const a of annots) {
    const ref = doc.context.register(buildAnnotation(doc, a));
    page.node.addAnnot(ref);
  }
}

function buildAnnotation(doc: PDFDocument, a: Annotation) {
  const { context } = doc;
  const rect = bounds(a);
  const [content, extra] = appearance(a);
  const gs = {
    Type: 'ExtGState',
    CA: a.opacity,
    ca: a.opacity,
    // Highlights darken the text under them instead of covering it.
    ...(a.type === 'highlight' ? { BM: 'Multiply' } : {}),
  };

  const ap = context.stream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: { ExtGState: { GS0: gs } },
  });

  const dict = context.obj({
    Type: 'Annot',
    Rect: rect,
    C: a.color,
    CA: a.opacity,
    // Print flag: annotations print like the rest of the page.
    F: 4,
    AP: { N: context.register(ap) },
  });
  dict.set(PDFName.of('NM'), PDFString.of(a.id));
  dict.set(PDFName.of('M'), PDFString.fromDate(new Date()));
  dict.set(PDFName.of('Contents'), PDFHexString.fromText(''));
  for (const [key, value] of Object.entries(extra)) dict.set(PDFName.of(key), context.obj(value as never));
  return dict;
}

/** Returns the appearance stream content and the subtype-specific dictionary entries. */
function appearance(a: Annotation): [string, Record<string, unknown>] {
  switch (a.type) {
    case 'highlight': {
      const ops = a.rects.map((r) => `${n(r[0])} ${n(r[1])} ${n(r[2] - r[0])} ${n(r[3] - r[1])} re f`).join('\n');
      return [
        `/GS0 gs ${rgb(a.color)} rg\n${ops}`,
        {
          Subtype: 'Highlight',
          // Per rectangle: upper-left, upper-right, lower-left, lower-right.
          QuadPoints: a.rects.flatMap((r) => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]]),
        },
      ];
    }
    case 'ink': {
      const paths = a.paths
        .map((p) => {
          const pts = p.length === 1 ? [p[0], p[0]] : p;
          return pts.map((pt, i) => `${n(pt[0])} ${n(pt[1])} ${i === 0 ? 'm' : 'l'}`).join(' ') + ' S';
        })
        .join('\n');
      return [
        `/GS0 gs ${rgb(a.color)} RG ${n(a.width)} w 1 J 1 j\n${paths}`,
        { Subtype: 'Ink', InkList: a.paths.map((p) => p.flat()), BS: { W: a.width } },
      ];
    }
    case 'shape':
      return shapeAppearance(a);
  }
}

function shapeAppearance(a: Extract<Annotation, { type: 'shape' }>): [string, Record<string, unknown>] {
  const stroke = `/GS0 gs ${rgb(a.color)} RG ${n(a.width)} w`;
  if (a.shape === 'line' || a.shape === 'arrow') {
    let ops = `${stroke} 1 J 1 j\n${n(a.from[0])} ${n(a.from[1])} m ${n(a.to[0])} ${n(a.to[1])} l S`;
    if (a.shape === 'arrow') {
      const [w1, w2] = arrowHead(a.from, a.to, arrowSize(a.width));
      ops += `\n${n(w1[0])} ${n(w1[1])} m ${n(a.to[0])} ${n(a.to[1])} l ${n(w2[0])} ${n(w2[1])} l S`;
    }
    return [
      ops,
      {
        Subtype: 'Line',
        L: [...a.from, ...a.to],
        LE: ['None', a.shape === 'arrow' ? 'OpenArrow' : 'None'],
        BS: { W: a.width },
      },
    ];
  }

  const r = normRect(a.from, a.to);
  const fill = a.fill ? ` ${rgb(a.fill)} rg` : '';
  const paint = a.fill ? 'B' : 'S';
  const path = a.shape === 'rect' ? `${n(r[0])} ${n(r[1])} ${n(r[2] - r[0])} ${n(r[3] - r[1])} re` : ellipsePath(r);
  const extra: Record<string, unknown> = { Subtype: a.shape === 'rect' ? 'Square' : 'Circle', BS: { W: a.width } };
  if (a.fill) extra.IC = a.fill;
  // The shape's outline is centered on its edge; RD tells viewers how far inside Rect it sits.
  extra.RD = [a.width / 2, a.width / 2, a.width / 2, a.width / 2];
  return [`${stroke}${fill}\n${path} ${paint}`, extra];
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
