// Draws boxed annotations (text, stamp, comment, image) on a canvas, for printing.
// Mirrors the saved PDF appearance (write-annotations.ts) and the on-screen view.
import { NOTE_OUTLINE, rgbToCss, STAMP_TEXT_RATIO, type BoxedAnnotation, type Point, type TextAnnotation } from './annotations';
import { loadMetrics, screenEnv } from './font-metrics-store.svelte';
import { layoutTextAnnotation, runsOf } from './text-rich';
import { CIRCLE_LINE_EM, segmentRuns, type ListMarker } from './text-rich-layout';
import { boxedGeometry } from './annotation-view';
import { cssFont, cssFontFor, ensureFontsFor, loadFonts } from './fonts';
import { bubblePath, NOTE_LINE_WIDTH, NOTE_LINES, NOTE_STROKE, traceCanvas } from './note-shape';

const ASCENT = 1.069;
const DESCENT = 0.293;

/** A text box in its upright frame (origin top-left, px): background, each run's text, underline / strikethrough, from the shared layout. */
function drawTextBox(ctx: CanvasRenderingContext2D, a: TextAnnotation, scale: number, w: number, h: number) {
  const { lines, bars, markers } = layoutTextAnnotation(a, screenEnv);
  if (a.background) {
    ctx.fillStyle = rgbToCss(a.background);
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fontKerning = 'none';
  ctx.textBaseline = 'alphabetic';
  for (const l of lines) {
    for (const s of l.segments) {
      if (!s.text.trim()) continue;
      ctx.font = cssFontFor(s.run, s.run.size * scale);
      ctx.fillStyle = rgbToCss(s.run.color);
      for (const piece of segmentRuns(s, (t) => screenEnv.measure(s.run, t))) ctx.fillText(piece.text, piece.x * scale, l.baseline * scale);
    }
  }
  for (const b of bars) {
    ctx.fillStyle = rgbToCss(b.run.color);
    ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
  }
  for (const m of markers) drawMarker(ctx, m, scale);
}

/** A list marker, as the PDF draws it (write-annotations.ts): a shape, or the number as text. */
function drawMarker(ctx: CanvasRenderingContext2D, m: ListMarker, scale: number) {
  const color = rgbToCss(m.run.color);
  if (m.kind === 'number') {
    ctx.font = cssFontFor(m.run, m.run.size * scale);
    ctx.fillStyle = color;
    ctx.fillText(m.text, (m.right - screenEnv.measure(m.run, m.text)) * scale, m.baseline * scale);
    return;
  }
  const r = (m.size / 2) * scale;
  const [x, y] = [m.cx * scale, m.cy * scale];
  ctx.beginPath();
  if (m.kind === 'square') {
    ctx.fillStyle = color;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  } else if (m.kind === 'disc') {
    ctx.fillStyle = color;
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
  } else {
    const line = CIRCLE_LINE_EM * m.run.size * scale;
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.arc(x, y, r - line / 2, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

export async function drawBoxed(
  ctx: CanvasRenderingContext2D,
  annots: readonly BoxedAnnotation[],
  toScreen: (p: Point) => Point,
  scale: number,
  pageRotation: number,
) {
  if (annots.some((a) => a.type === 'stamp')) await loadFonts();
  const texts = annots.flatMap((a) => (a.type === 'text' ? [a] : []));
  const runs = texts.flatMap(runsOf);
  await ensureFontsFor(runs);
  await Promise.all(runs.map((r) => loadMetrics(r)));
  for (const a of annots) {
    const g = boxedGeometry(a, toScreen, scale, pageRotation);
    ctx.save();
    ctx.globalAlpha = a.opacity;
    ctx.translate(g.cx, g.cy);
    ctx.rotate((g.turn * Math.PI) / 180);
    ctx.translate(-g.w / 2, -g.h / 2);
    if (a.type === 'text') {
      // Text and background fade together, like the saved PDF's transparency group.
      if (a.opacity < 1 && a.background) {
        const t = ctx.getTransform();
        const k = Math.hypot(t.a, t.b) || 1;
        const off = new OffscreenCanvas(Math.max(1, Math.ceil(g.w * k)), Math.max(1, Math.ceil(g.h * k)));
        const octx = off.getContext('2d')!;
        octx.scale(k, k);
        drawTextBox(octx as unknown as CanvasRenderingContext2D, a, scale, g.w, g.h);
        ctx.drawImage(off, 0, 0, g.w, g.h);
      } else {
        drawTextBox(ctx, a, scale, g.w, g.h);
      }
    } else if (a.type === 'stamp') {
      const inset = Math.max(1.5, g.h * 0.06);
      ctx.strokeStyle = ctx.fillStyle = rgbToCss(a.color);
      ctx.lineWidth = inset;
      ctx.beginPath();
      ctx.roundRect(inset / 2, inset / 2, g.w - inset, g.h - inset, g.h * 0.15);
      ctx.stroke();
      ctx.font = cssFont('sans-bold', g.h * STAMP_TEXT_RATIO);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.label, g.w / 2, g.h / 2);
    } else if (a.type === 'note') {
      const s = g.w / 22;
      ctx.scale(s, s);
      ctx.translate(0, 22);
      ctx.scale(1, -1);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.fillStyle = rgbToCss(a.color);
      ctx.strokeStyle = rgbToCss(NOTE_OUTLINE);
      // Box and tail are one closed path: the outline runs all the way round.
      traceCanvas(ctx, bubblePath());
      ctx.fill();
      ctx.lineWidth = NOTE_STROKE;
      ctx.stroke();
      ctx.beginPath();
      for (const [x1, y, x2] of NOTE_LINES) {
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
      }
      ctx.lineWidth = NOTE_LINE_WIDTH;
      ctx.stroke();
    } else {
      const img = new Image();
      img.src = a.dataUrl;
      await img.decode();
      if (a.flipX || a.flipY) {
        ctx.translate(a.flipX ? g.w : 0, a.flipY ? g.h : 0);
        ctx.scale(a.flipX ? -1 : 1, a.flipY ? -1 : 1);
      }
      // Only the cropped part of the original.
      const [x0, y0, x1, y1] = a.crop ?? [0, 0, 1, 1];
      const [nw, nh] = [img.naturalWidth, img.naturalHeight];
      ctx.drawImage(img, x0 * nw, y0 * nh, (x1 - x0) * nw, (y1 - y0) * nh, 0, 0, g.w, g.h);
    }
    ctx.restore();
  }
}
