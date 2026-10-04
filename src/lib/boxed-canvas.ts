// Draws boxed annotations (text, stamp, comment, image) on a canvas, for printing.
// Mirrors the saved PDF appearance (write-annotations.ts) and the on-screen view.
import { NOTE_OUTLINE, rgbToCss, STAMP_TEXT_RATIO, type BoxedAnnotation, type Point } from './annotations';
import { boxedGeometry } from './annotation-view';
import { cssFont, cssFontFor, ensureFontsFor, LINE_HEIGHT, loadFonts, TEXT_PADDING } from './fonts';
import { firstBaseline } from './font-catalog';

const ASCENT = 1.069;
const DESCENT = 0.293;

export async function drawBoxed(
  ctx: CanvasRenderingContext2D,
  annots: readonly BoxedAnnotation[],
  toScreen: (p: Point) => Point,
  scale: number,
  pageRotation: number,
) {
  if (annots.some((a) => a.type === 'stamp')) await loadFonts();
  await ensureFontsFor(annots.flatMap((a) => (a.type === 'text' ? [a] : [])));
  for (const a of annots) {
    const g = boxedGeometry(a, toScreen, scale, pageRotation);
    ctx.save();
    ctx.globalAlpha = a.opacity;
    ctx.translate(g.cx, g.cy);
    ctx.rotate((g.turn * Math.PI) / 180);
    ctx.translate(-g.w / 2, -g.h / 2);
    if (a.type === 'text') {
      const size = a.size * scale;
      const lineH = size * LINE_HEIGHT;
      ctx.font = cssFontFor(a, size);
      ctx.fillStyle = rgbToCss(a.color);
      ctx.textBaseline = 'alphabetic';
      const first = firstBaseline(a.font, a.size, LINE_HEIGHT, TEXT_PADDING) * scale;
      a.lines.forEach((line, i) => ctx.fillText(line, TEXT_PADDING * scale, first + i * lineH));
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
      ctx.fillStyle = rgbToCss(a.color);
      ctx.strokeStyle = rgbToCss(NOTE_OUTLINE);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(1, 6.16, 20, 15.4, 2.64);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5.5, 6.16);
      ctx.lineTo(4.4, 1);
      ctx.lineTo(9.9, 6.16);
      ctx.fill();
      ctx.beginPath();
      for (const [y, x2] of [[17.6, 17.6], [13.86, 17.6], [10.12, 13.2]]) {
        ctx.moveTo(4.4, y);
        ctx.lineTo(x2, y);
      }
      ctx.stroke();
    } else {
      const img = new Image();
      img.src = a.dataUrl;
      await img.decode();
      ctx.drawImage(img, 0, 0, g.w, g.h);
    }
    ctx.restore();
  }
}
