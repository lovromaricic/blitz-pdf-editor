// Runs a page's content stream the way a viewer would, but instead of drawing
// it records where things are: every text-showing operation (with each glyph's
// box, its text, font, size and color) and every image (XObject or inline),
// in page space, with the operation's index so it can be edited. Form
// XObjects are followed (their items carry the path of forms they're in).
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, type PDFObject, type PDFPage } from '@cantoo/pdf-lib';
import { isDict, isName, isStr, num, tokenize, type Op, type Operand } from './lexer';
import { loadFont, type FontInfo } from './fonts';

/** A PDF matrix [a b c d e f] (row-vector convention: p' = p × M). */
export type Matrix = [number, number, number, number, number, number];
export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}
export const apply = (m: Matrix, x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export interface Glyph {
  code: number;
  text: string;
  /** Glyph box (advance × ascent..descent) in page space: bottom-left, bottom-right, top-right, top-left. */
  quad: Quad;
}

/** Where an item's operation lives: the page's content, or inside form XObjects (outermost first). */
export interface OpRef {
  /** Form XObject refs ("12 0 R") from the page down; empty for the page's own content. */
  forms: string[];
  index: number;
}

export interface MarkedContent {
  tag: string;
  mcid?: number;
  actualText?: string;
  /** The BDC/BMC operation. */
  at: OpRef;
}

export interface TextRun {
  kind: 'text';
  at: OpRef;
  op: string;
  glyphs: Glyph[];
  font: FontInfo;
  /** Resource name of the font (/F1…). */
  fontKey: string;
  /** Font size as it appears on the page (Tf size × matrix scale), points. */
  size: number;
  /** Direction of the baseline in page space, degrees counter-clockwise. */
  angle: number;
  color: [number, number, number] | null;
  /** Text render mode 3: invisible (an OCR layer). */
  invisible: boolean;
  /** Horizontal displacement of the whole operation in unscaled text space, for replacing it with a move. */
  advance: number;
  /** Tf size and Tz, to express `advance` as a TJ adjustment. */
  tfs: number;
  th: number;
  marked: MarkedContent[];
  /** Drawing order on the page (later is on top). */
  seq: number;
}

export interface ImageItem {
  kind: 'image';
  at: OpRef;
  /** The XObject's resource name and ref (inline images: none). */
  name?: string;
  ref?: string;
  inline: boolean;
  /** The unit square through the CTM, in page space. */
  quad: Quad;
  width: number;
  height: number;
  /** Stencil masks, SMasks, alternates…: things that complicate removal. */
  notes: string[];
  marked: MarkedContent[];
  seq: number;
}

export interface PageContent {
  text: TextRun[];
  images: ImageItem[];
  /** Path-painting operations (count, and their joint bounding box in page space). */
  paths: { count: number; box: [number, number, number, number] | null };
  /** Each visible painted path's box in page space, with its drawing order (white fills, which look like nothing, left out). */
  shapes: { box: [number, number, number, number]; seq: number }[];
  /** Form XObjects used, with how often (a form used more than once must be copied before it's edited). */
  forms: Map<string, number>;
  /** Operations of each stream, by form path ("" for the page). */
  streams: Map<string, Op[]>;
  problems: string[];
}

interface GState {
  ctm: Matrix;
  fill: [number, number, number] | null;
  fillSpace: string;
  font: FontInfo | null;
  fontKey: string;
  tfs: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  rise: number;
  render: number;
}

const MAX_FORM_DEPTH = 12;
/** Path boxes kept per page (for telling what a double-click hit); a page with more is mostly drawing anyway. */
const MAX_SHAPES = 5000;

export function pageResources(page: PDFPage): PDFDict | undefined {
  let node: PDFDict | undefined = page.node;
  while (node) {
    const r = node.lookup(PDFName.of('Resources'));
    if (r instanceof PDFDict) return r;
    const parent: PDFObject | undefined = node.lookup(PDFName.of('Parent'));
    node = parent instanceof PDFDict ? parent : undefined;
  }
  return undefined;
}

export function streamData(s: PDFObject | undefined): Uint8Array {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  if (s instanceof PDFStream) return (s as PDFStream & { getContents(): Uint8Array }).getContents();
  return new Uint8Array();
}

/** The page's content streams joined (with a line break between them, as viewers read them). */
export function pageContentBytes(page: PDFPage): Uint8Array {
  const c = page.node.get(PDFName.of('Contents'));
  const ctx = page.node.context;
  const target = c instanceof PDFRef ? ctx.lookup(c) : c;
  const parts: Uint8Array[] = [];
  if (target instanceof PDFArray) for (const x of target.asArray()) parts.push(streamData(x instanceof PDFRef ? ctx.lookup(x) : x));
  else if (target) parts.push(streamData(target));
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    out[at + p.length] = 0x0a;
    at += p.length + 1;
  }
  return out;
}

export function interpretPage(page: PDFPage): PageContent {
  const ctx = page.node.context;
  const result: PageContent = { text: [], images: [], paths: { count: 0, box: null }, shapes: [], forms: new Map(), streams: new Map(), problems: [] };
  let seq = 0;
  const fontCache = new Map<string, FontInfo>();
  const resources = pageResources(page);
  run(pageContentBytes(page), resources, IDENTITY, [], 0);
  return result;

  function run(bytes: Uint8Array, res: PDFDict | undefined, base: Matrix, forms: string[], depth: number) {
    let ops: Op[];
    try {
      ops = tokenize(bytes);
    } catch (e) {
      result.problems.push(`content can't be read${forms.length ? ' (in a form)' : ''}: ${(e as Error).message}`);
      return;
    }
    result.streams.set(forms.join('/'), ops);
    const stack: GState[] = [];
    let g: GState = { ctm: base, fill: [0, 0, 0], fillSpace: 'DeviceGray', font: null, fontKey: '', tfs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, render: 0 };
    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;
    const marked: MarkedContent[] = [];
    let pathBox: [number, number, number, number] | null = null;
    let cur: Point = [0, 0];

    const addPathPoint = (x: number, y: number) => {
      const [px, py] = apply(g.ctm, x, y);
      pathBox = pathBox ? [Math.min(pathBox[0], px), Math.min(pathBox[1], py), Math.max(pathBox[2], px), Math.max(pathBox[3], py)] : [px, py, px, py];
    };

    const fontFor = (key: string): FontInfo | null => {
      const fonts = res?.lookup(PDFName.of('Font'));
      if (!(fonts instanceof PDFDict)) return null;
      const raw = fonts.get(PDFName.of(key));
      const id = raw instanceof PDFRef ? raw.toString() : `${forms.join('/')}:${key}`;
      let f = fontCache.get(id);
      if (!f) {
        const dict = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
        if (!(dict instanceof PDFDict)) return null;
        f = loadFont(dict);
        fontCache.set(id, f);
      }
      return f;
    };

    const setColor = (operands: Operand[], space: string) => {
      const v = operands.filter((o): o is number => typeof o === 'number');
      if (space === 'DeviceGray' || v.length === 1) return [v[0], v[0], v[0]] as [number, number, number];
      if (space === 'DeviceRGB' || v.length === 3) return [v[0], v[1], v[2]] as [number, number, number];
      if (space === 'DeviceCMYK' || v.length === 4) return [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])] as [number, number, number];
      return null;
    };
    const spaceOf = (o: Operand | undefined) => {
      if (!isName(o)) return '?';
      if (['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Pattern'].includes(o.name)) return o.name;
      const cs = res?.lookup(PDFName.of('ColorSpace'));
      const def = cs instanceof PDFDict ? cs.lookup(PDFName.of(o.name)) : undefined;
      if (def instanceof PDFArray) {
        const kind = def.lookup(0);
        if (kind instanceof PDFName && kind.decodeText() === 'ICCBased') {
          const stream = def.lookup(1);
          const n = stream instanceof PDFStream ? (stream.dict.lookup(PDFName.of('N')) as PDFNumber | undefined)?.asNumber() : undefined;
          return n === 1 ? 'DeviceGray' : n === 4 ? 'DeviceCMYK' : 'DeviceRGB';
        }
        return kind instanceof PDFName ? kind.decodeText() : '?';
      }
      return '?';
    };

    const show = (op: Op, index: number, items: (Uint8Array | number)[]) => {
      const f = g.font;
      if (!f) {
        result.problems.push('text without a font');
        return;
      }
      const glyphs: Glyph[] = [];
      const start = tm;
      let advance = 0;
      for (const it of items) {
        if (typeof it === 'number') {
          const d = (-it / 1000) * g.tfs * (f.vertical ? 1 : g.th);
          if (f.vertical) tm = mul([1, 0, 0, 1, 0, d], tm);
          else tm = mul([1, 0, 0, 1, d, 0], tm);
          advance += f.vertical ? 0 : d;
          continue;
        }
        for (const { code, len } of f.codes(it)) {
          const w0 = f.width(code) * f.scale;
          const space = len === 1 && code === 32 ? g.tw : 0;
          const trm = mul([g.tfs * g.th, 0, 0, g.tfs, 0, g.rise], mul(tm, g.ctm));
          if (f.vertical) {
            const half = 0.5;
            const quad: Quad = [apply(trm, -half, -1), apply(trm, half, -1), apply(trm, half, 0), apply(trm, -half, 0)];
            glyphs.push({ code, text: f.unicode(code), quad });
            const ty = -1 * g.tfs + g.tc + space;
            tm = mul([1, 0, 0, 1, 0, ty], tm);
          } else {
            const quad: Quad = [apply(trm, 0, f.descent), apply(trm, w0, f.descent), apply(trm, w0, f.ascent), apply(trm, 0, f.ascent)];
            glyphs.push({ code, text: f.unicode(code), quad });
            const tx = (w0 * g.tfs + g.tc + space) * g.th;
            tm = mul([1, 0, 0, 1, tx, 0], tm);
            advance += tx;
          }
        }
      }
      const m = mul([g.tfs * g.th, 0, 0, g.tfs, 0, g.rise], mul(start, g.ctm));
      const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
      const size = Math.hypot(m[2], m[3]);
      result.text.push({
        kind: 'text',
        at: { forms, index },
        op: op.op,
        glyphs,
        font: f,
        fontKey: g.fontKey,
        size,
        angle,
        color: g.fill,
        invisible: g.render === 3 || g.render === 7,
        advance,
        tfs: g.tfs,
        th: g.th,
        marked: [...marked],
        seq: seq++,
      });
    };

    ops.forEach((op, index) => {
      const o = op.operands;
      switch (op.op) {
        case 'q':
          stack.push({ ...g });
          break;
        case 'Q':
          if (stack.length) g = stack.pop()!;
          break;
        case 'cm':
          g.ctm = mul(o.map((x) => num(x)) as Matrix, g.ctm);
          break;
        case 'g':
          g.fillSpace = 'DeviceGray';
          g.fill = setColor(o, 'DeviceGray');
          break;
        case 'rg':
          g.fillSpace = 'DeviceRGB';
          g.fill = setColor(o, 'DeviceRGB');
          break;
        case 'k':
          g.fillSpace = 'DeviceCMYK';
          g.fill = setColor(o, 'DeviceCMYK');
          break;
        case 'cs':
          g.fillSpace = spaceOf(o[0]);
          g.fill = g.fillSpace === 'DeviceCMYK' ? [0, 0, 0] : g.fillSpace === 'Pattern' ? null : [0, 0, 0];
          break;
        case 'sc':
        case 'scn':
          g.fill = isName(o[o.length - 1]) ? null : setColor(o, g.fillSpace);
          break;
        case 'BT':
          tm = tlm = IDENTITY;
          break;
        case 'ET':
          break;
        case 'Tf':
          g.fontKey = isName(o[0]) ? o[0].name : '';
          g.font = fontFor(g.fontKey);
          g.tfs = num(o[1]);
          break;
        case 'Tc':
          g.tc = num(o[0]);
          break;
        case 'Tw':
          g.tw = num(o[0]);
          break;
        case 'Tz':
          g.th = num(o[0], 100) / 100;
          break;
        case 'TL':
          g.tl = num(o[0]);
          break;
        case 'Ts':
          g.rise = num(o[0]);
          break;
        case 'Tr':
          g.render = num(o[0]);
          break;
        case 'Td':
          tlm = tm = mul([1, 0, 0, 1, num(o[0]), num(o[1])], tlm);
          break;
        case 'TD':
          g.tl = -num(o[1]);
          tlm = tm = mul([1, 0, 0, 1, num(o[0]), num(o[1])], tlm);
          break;
        case 'Tm':
          tlm = tm = o.map((x) => num(x)) as Matrix;
          break;
        case 'T*':
          tlm = tm = mul([1, 0, 0, 1, 0, -g.tl], tlm);
          break;
        case 'Tj':
          if (isStr(o[0])) show(op, index, [o[0].bytes]);
          break;
        case "'":
          tlm = tm = mul([1, 0, 0, 1, 0, -g.tl], tlm);
          if (isStr(o[0])) show(op, index, [o[0].bytes]);
          break;
        case '"':
          g.tw = num(o[0]);
          g.tc = num(o[1]);
          tlm = tm = mul([1, 0, 0, 1, 0, -g.tl], tlm);
          if (isStr(o[2])) show(op, index, [o[2].bytes]);
          break;
        case 'TJ':
          if (Array.isArray(o[0])) show(op, index, o[0].flatMap((x): (Uint8Array | number)[] => (isStr(x) ? [x.bytes] : typeof x === 'number' ? [x] : [])));
          break;
        case 'BMC':
        case 'BDC': {
          const props = o[1];
          let dict: Map<string, Operand> | undefined;
          if (isDict(props)) dict = props.dict;
          else if (isName(props)) {
            const pr = res?.lookup(PDFName.of('Properties'));
            const d = pr instanceof PDFDict ? pr.lookup(PDFName.of(props.name)) : undefined;
            if (d instanceof PDFDict) {
              dict = new Map();
              const mc = d.lookup(PDFName.of('MCID'));
              if (mc instanceof PDFNumber) dict.set('MCID', mc.asNumber());
              const at = d.lookup(PDFName.of('ActualText'));
              if (at) dict.set('ActualText', { bytes: new TextEncoder().encode((at as unknown as { decodeText?(): string }).decodeText?.() ?? ''), hex: false });
            }
          }
          const mcid = dict?.get('MCID');
          const at = dict?.get('ActualText');
          marked.push({
            tag: isName(o[0]) ? o[0].name : '',
            mcid: typeof mcid === 'number' ? mcid : undefined,
            actualText: isStr(at) ? decodeTextString(at.bytes) : undefined,
            at: { forms, index },
          });
          break;
        }
        case 'EMC':
          marked.pop();
          break;
        case 'm':
          cur = [num(o[0]), num(o[1])];
          addPathPoint(...cur);
          break;
        case 'l':
          addPathPoint(num(o[0]), num(o[1]));
          break;
        case 'c':
          addPathPoint(num(o[4]), num(o[5]));
          break;
        case 'v':
        case 'y':
          addPathPoint(num(o[2]), num(o[3]));
          break;
        case 're':
          addPathPoint(num(o[0]), num(o[1]));
          addPathPoint(num(o[0]) + num(o[2]), num(o[1]) + num(o[3]));
          break;
        case 'f':
        case 'F':
        case 'f*':
        case 'S':
        case 's':
        case 'B':
        case 'B*':
        case 'b':
        case 'b*':
          result.paths.count++;
          if (pathBox) {
            const b = result.paths.box;
            result.paths.box = b ? [Math.min(b[0], pathBox[0]), Math.min(b[1], pathBox[1]), Math.max(b[2], pathBox[2]), Math.max(b[3], pathBox[3])] : pathBox;
            const fillOnly = op.op === 'f' || op.op === 'F' || op.op === 'f*';
            const white = !!g.fill && g.fill.every((v) => v > 0.98);
            if (!(fillOnly && white) && result.shapes.length < MAX_SHAPES) result.shapes.push({ box: pathBox, seq: seq++ });
          }
          pathBox = null;
          break;
        case 'n':
          pathBox = null;
          break;
        case 'BI': {
          const d = op.inline!.dict;
          result.images.push({
            kind: 'image',
            at: { forms, index },
            inline: true,
            quad: unitQuad(g.ctm),
            width: num(d.get('W') ?? d.get('Width')),
            height: num(d.get('H') ?? d.get('Height')),
            notes: d.get('IM') === true || d.get('ImageMask') === true ? ['stencil mask'] : [],
            marked: [...marked],
            seq: seq++,
          });
          break;
        }
        case 'Do': {
          if (!isName(o[0])) break;
          const xo = res?.lookup(PDFName.of('XObject'));
          const raw = xo instanceof PDFDict ? xo.get(PDFName.of(o[0].name)) : undefined;
          const obj = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
          if (!(obj instanceof PDFStream)) break;
          const sub = obj.dict.lookup(PDFName.of('Subtype'));
          const kind = sub instanceof PDFName ? sub.decodeText() : '';
          if (kind === 'Image') {
            const notes: string[] = [];
            if (obj.dict.lookup(PDFName.of('ImageMask'))?.toString() === 'true') notes.push('stencil mask');
            if (obj.dict.has(PDFName.of('SMask'))) notes.push('soft mask');
            if (obj.dict.has(PDFName.of('Mask'))) notes.push('mask');
            if (obj.dict.has(PDFName.of('Alternates'))) notes.push('alternates');
            result.images.push({
              kind: 'image',
              at: { forms, index },
              name: o[0].name,
              ref: raw instanceof PDFRef ? raw.toString() : undefined,
              inline: false,
              quad: unitQuad(g.ctm),
              width: (obj.dict.lookup(PDFName.of('Width')) as PDFNumber | undefined)?.asNumber() ?? 0,
              height: (obj.dict.lookup(PDFName.of('Height')) as PDFNumber | undefined)?.asNumber() ?? 0,
              notes,
              marked: [...marked],
              seq: seq++,
            });
          } else if (kind === 'Form') {
            const key = raw instanceof PDFRef ? raw.toString() : `inline-form-${index}`;
            result.forms.set(key, (result.forms.get(key) ?? 0) + 1);
            if (depth >= MAX_FORM_DEPTH || forms.includes(key)) {
              result.problems.push('form XObjects nested too deeply');
              break;
            }
            const fm = obj.dict.lookup(PDFName.of('Matrix'));
            const matrix = fm instanceof PDFArray ? (fm.asArray().map((x) => (x as PDFNumber).asNumber?.() ?? 0) as Matrix) : IDENTITY;
            const fres = obj.dict.lookup(PDFName.of('Resources'));
            const saved = { ...g };
            run(streamData(obj), fres instanceof PDFDict ? fres : res, mul(matrix, g.ctm), [...forms, key], depth + 1);
            g = saved;
          }
          break;
        }
        case 'sh':
          result.paths.count++;
          break;
        default:
          break;
      }
      void cur;
    });
  }
}

function unitQuad(m: Matrix): Quad {
  return [apply(m, 0, 0), apply(m, 1, 0), apply(m, 1, 1), apply(m, 0, 1)];
}

/** PDF text strings: UTF-16BE with a BOM, else PDFDocEncoding (close to Latin-1). */
export function decodeTextString(b: Uint8Array) {
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    let s = '';
    for (let k = 2; k + 1 < b.length; k += 2) s += String.fromCharCode((b[k] << 8) | b[k + 1]);
    return s;
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder().decode(b.subarray(3));
  return Array.from(b, (c) => String.fromCharCode(c)).join('');
}
