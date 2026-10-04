// Turns annotations into simple screen-space drawing primitives. One source of
// truth for the editor overlay, thumbnails and printing. No DOM access.
import { arrowHead, arrowSize, normRect, rgbToCss, type Annotation, type Point, type Rect } from './annotations';

export type ToScreen = (p: Point) => Point;

export type Primitive =
  | { kind: 'polygon'; points: Point[]; fill: string; opacity: number; multiply?: boolean }
  | { kind: 'polyline'; points: Point[]; stroke: string; width: number; opacity: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; stroke: string; fill: string | null; width: number; opacity: number };

/** `scale` is CSS px per point, for stroke widths. */
export function toPrimitives(a: Annotation, toScreen: ToScreen, scale: number): Primitive[] {
  const corners = (r: Rect): Point[] => [toScreen([r[0], r[1]]), toScreen([r[2], r[1]]), toScreen([r[2], r[3]]), toScreen([r[0], r[3]])];
  switch (a.type) {
    case 'highlight':
      return a.rects.map((r) => ({ kind: 'polygon', points: corners(r), fill: rgbToCss(a.color), opacity: a.opacity, multiply: true }));
    case 'ink':
      return a.paths.map((path) => ({
        kind: 'polyline',
        points: (path.length === 1 ? [path[0], path[0]] : path).map(toScreen),
        stroke: rgbToCss(a.color),
        width: a.width * scale,
        opacity: a.opacity,
      }));
    case 'shape': {
      const stroke = rgbToCss(a.color);
      const width = a.width * scale;
      if (a.shape === 'line' || a.shape === 'arrow') {
        const from = toScreen(a.from);
        const to = toScreen(a.to);
        const out: Primitive[] = [{ kind: 'polyline', points: [from, to], stroke, width, opacity: a.opacity }];
        if (a.shape === 'arrow') {
          const [w1, w2] = arrowHead(a.from, a.to, arrowSize(a.width));
          out.push({ kind: 'polyline', points: [toScreen(w1), to, toScreen(w2)], stroke, width, opacity: a.opacity });
        }
        return out;
      }
      const r = normRect(a.from, a.to);
      if (a.shape === 'rect') {
        const pts = corners(r);
        const fill = a.fill ? rgbToCss(a.fill) : null;
        const prims: Primitive[] = [];
        if (fill) prims.push({ kind: 'polygon', points: pts, fill, opacity: a.opacity });
        prims.push({ kind: 'polyline', points: [...pts, pts[0]], stroke, width, opacity: a.opacity });
        return prims;
      }
      const b = screenBox(corners(r));
      return [
        {
          kind: 'ellipse',
          cx: (b[0] + b[2]) / 2,
          cy: (b[1] + b[3]) / 2,
          rx: (b[2] - b[0]) / 2,
          ry: (b[3] - b[1]) / 2,
          stroke,
          fill: a.fill ? rgbToCss(a.fill) : null,
          width,
          opacity: a.opacity,
        },
      ];
    }
  }
}

/** Axis-aligned box [x1, y1, x2, y2] around screen points. */
export function screenBox(points: Point[]): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function pointsAttr(points: Point[]) {
  return points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
}

/** Standalone SVG markup for a set of primitives (used for printing). */
export function primitivesToSvg(prims: Primitive[], width: number, height: number): string {
  const body = prims
    .map((p) => {
      if (p.kind === 'polygon') {
        const blend = p.multiply ? ' style="mix-blend-mode:multiply"' : '';
        return `<polygon points="${pointsAttr(p.points)}" fill="${p.fill}" fill-opacity="${p.opacity}"${blend}/>`;
      }
      if (p.kind === 'polyline') {
        return `<polyline points="${pointsAttr(p.points)}" fill="none" stroke="${p.stroke}" stroke-width="${p.width}" stroke-opacity="${p.opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" fill="${p.fill ?? 'none'}" fill-opacity="${p.opacity}" stroke="${p.stroke}" stroke-width="${p.width}" stroke-opacity="${p.opacity}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}
