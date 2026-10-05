// Generates the PDFs in test-fixtures/content/ used to research and test editing
// a PDF's original content (text blocks and images). Every file is made here,
// from our own words and our bundled (Apache-licensed) fonts, so all of them
// may be kept in the repo. Run: node build-tools/content-fixtures.ts
//
// Producers: Chromium's print-to-PDF (Skia), pdf-lib, hand-written PDF syntax,
// and openssl (a real CMS signature with a throwaway self-signed key).
import { chromium } from '@playwright/test';
import fontkit from '@cantoo/fontkit';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from '@cantoo/pdf-lib';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'test-fixtures/content';
mkdirSync(OUT, { recursive: true });

const fontFile = (pkg: string, dir: string, name: string) => readFileSync(`node_modules/@expo-google-fonts/${pkg}/${dir}/${name}`);
const ARIMO = fontFile('arimo', '400Regular', 'Arimo_400Regular.ttf');
const ARIMO_BOLD = fontFile('arimo', '700Bold', 'Arimo_700Bold.ttf');
const TINOS = fontFile('tinos', '400Regular', 'Tinos_400Regular.ttf');
const dataUrl = (b: Buffer) => `data:font/ttf;base64,${b.toString('base64')}`;
const FONT_CSS = `
  @font-face { font-family: 'Arimo'; font-weight: 400; src: url(${dataUrl(ARIMO)}); }
  @font-face { font-family: 'Arimo'; font-weight: 700; src: url(${dataUrl(ARIMO_BOLD)}); }
  @font-face { font-family: 'Tinos'; font-weight: 400; src: url(${dataUrl(TINOS)}); }
  html { -webkit-print-color-adjust: exact; }
  body { margin: 0; font-family: 'Arimo'; font-size: 11pt; line-height: 1.35; color: #1d2530; }
  h1 { font-size: 20pt; margin: 0 0 14pt; }
  h2 { font-size: 14pt; margin: 16pt 0 8pt; }
  p { margin: 0 0 10pt; }
`;

/** Lorem-free filler: our own sentences, so the text is ours to keep. */
const SENTENCES = [
  'The committee met on Tuesday to review the plan for the new library wing.',
  'Members agreed that the reading room should face the garden and keep its tall windows.',
  'A first estimate puts the cost at a little under two million, spread over three years.',
  'Volunteers will catalogue the donated books before the move begins in spring.',
  'The children’s section gets its own entrance, with low shelves and a quiet corner.',
  'Questions about the schedule can be sent to the office at any time before the next meeting.',
];
const para = (n: number, from = 0) => Array.from({ length: n }, (_, i) => SENTENCES[(from + i) % SENTENCES.length]).join(' ');

async function chromePdf(html: string, opts: { canvasImage?: boolean } = {}) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${FONT_CSS}</style></head><body>${html}</body></html>`);
  if (opts.canvasImage) {
    // A raster image (Chromium embeds <img> as an image XObject; canvas-made so it's ours).
    await page.evaluate(() => {
      for (const img of document.querySelectorAll<HTMLImageElement>('img[data-make]')) {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 180;
        const ctx = c.getContext('2d')!;
        const g = ctx.createLinearGradient(0, 0, 320, 180);
        g.addColorStop(0, '#2a6f97');
        g.addColorStop(1, '#e9c46a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(230, 70, 40, 0, Math.PI * 2);
        ctx.fill();
        img.src = c.toDataURL('image/png');
      }
    });
  }
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: 'A4', printBackground: true, tagged: true, margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' } });
  // Positions of form boxes, for the bank form's fields (CSS px from the page's top-left).
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-field]')].map((e) => {
      const r = e.getBoundingClientRect();
      return { name: e.dataset.field!, x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
  await browser.close();
  return { pdf: new Uint8Array(pdf), boxes };
}

async function save(name: string, bytes: Uint8Array) {
  writeFileSync(join(OUT, name), bytes);
  console.log(`${name}  ${(bytes.length / 1024).toFixed(1)} KB`);
}

// --- Chromium print-to-PDF ------------------------------------------------------------------

async function chromeArticle() {
  const { pdf } = await chromePdf(
    `<h1>Library Wing Proposal</h1>
     <p style="color:#5b6573">Prepared for the town council, March 2026</p>
     <p>${para(3)}</p>
     <p>${para(3, 3)}</p>
     <img data-make style="display:block;width:240pt;height:135pt;margin:4pt 0 12pt">
     <h2>Next steps</h2>
     <p>${para(2, 1)}</p>
     <p style="text-align:center">${para(1, 4)}</p>
     <p style="text-align:right">Signed, the planning group</p>`,
    { canvasImage: true },
  );
  await save('chrome-article.pdf', pdf);
}

async function chromeCroatian() {
  const { pdf } = await chromePdf(
    `<h1>Obavijest stanarima</h1>
     <p>Poštovani stanari, u četvrtak će se od 8 do 12 sati isključiti voda zbog popravka cijevi u podrumu. Molimo vas da na vrijeme natočite vodu za kuhanje i piće.</p>
     <p style="font-family:Tinos;font-size:12pt">Đurđica Šimić, predstavnica suvlasnika, zahvaljuje svima na strpljenju. Žalbe i pitanja možete ostaviti u sandučiću kraj ulaza ili poslati poštom.</p>
     <p>Čišćenje stubišta je <b>svakog ponedjeljka</b>, a odvoz glomaznog otpada <b>prve subote u mjesecu</b>. Ćelije s brojilima ostaju zaključane.</p>
     <p style="font-size:9pt;color:#5b6573">ČĆŽŠĐ čćžšđ — posebna slova moraju ostati ispravna nakon uređivanja.</p>`,
  );
  await save('chrome-croatian-subset.pdf', pdf);
}

async function chromeColumns() {
  const { pdf } = await chromePdf(
    `<h1>Neighbourhood Newsletter</h1>
     <div style="column-count:2;column-gap:24pt">
       <p>${para(4)}</p><p>${para(3, 2)}</p><p>${para(4, 1)}</p><p>${para(3, 4)}</p>
     </div>`,
  );
  await save('chrome-columns.pdf', pdf);
}

async function chromeHard() {
  // The awkward cases: a table, a bulleted list, justified text, superscripts and a footnote.
  const cell = (t: string) => `<td style="border:1px solid #8a94a3;padding:4pt 6pt">${t}</td>`;
  const { pdf } = await chromePdf(
    `<h1>Budget summary</h1>
     <table style="border-collapse:collapse;font-size:10pt;margin-bottom:14pt">
       <tr>${['Item', 'Q1', 'Q2', 'Total'].map(cell).join('')}</tr>
       <tr>${['Books', '1,200', '900', '2,100'].map(cell).join('')}</tr>
       <tr>${['Shelving', '4,500', '0', '4,500'].map(cell).join('')}</tr>
     </table>
     <ul style="margin:0 0 12pt;padding-left:18pt">
       <li style="margin-bottom:6pt">Order the shelving before May.</li>
       <li style="margin-bottom:6pt">Ask the volunteers about the weekend shifts.</li>
       <li>Confirm the delivery date with the supplier.</li>
     </ul>
     <p style="text-align:justify">${para(4, 2)} The estimate<sup>1</sup> includes taxes and the area is 240 m<sup>2</sup>.</p>
     <p style="font-size:8pt;color:#5b6573;margin-top:24pt"><sup>1</sup> Prices from the March catalogue.</p>`,
  );
  await save('chrome-table-list.pdf', pdf);
}

async function bankForm() {
  // A fictional bank ("Banka Primjer d.d."), laid out by Chromium, with real form fields added.
  const field = (label: string, name: string) =>
    `<p style="margin:0 0 4pt;font-size:9pt;color:#5b6573">${label}</p>
     <div data-field="${name}" style="height:20pt;border:1px solid #8a94a3;margin:0 0 12pt"></div>`;
  const { pdf, boxes } = await chromePdf(
    `<h1 style="font-size:16pt">Banka Primjer d.d.</h1>
     <h2 style="margin-top:0">Zahtjev za otvaranje tekućeg računa</h2>
     <p style="font-size:9pt">Molimo ispunite sva polja tiskanim slovima. Podaci se obrađuju u skladu s općim uvjetima poslovanja banke.</p>
     ${field('Ime i prezime', 'ime')}
     ${field('OIB', 'oib')}
     ${field('Adresa prebivališta', 'adresa')}
     ${field('Datum rođenja (dd.mm.gggg.)', 'datum')}
     <p style="font-size:8pt;color:#5b6573;margin-top:20pt">Potpisom potvrđujem da su navedeni podaci točni. Ovaj obrazac je primjer i ne pripada nijednoj stvarnoj banci.</p>`,
  );
  const doc = await PDFDocument.load(pdf);
  const form = doc.getForm();
  const page = doc.getPage(0);
  const H = page.getHeight();
  const mm = 72 / 25.4;
  for (const b of boxes) {
    // CSS px inside the 20 mm margins → points from the page's bottom-left.
    const x = 20 * mm + b.x * 0.75;
    const top = 20 * mm + b.y * 0.75;
    const f = form.createTextField(`zahtjev.${b.name}`);
    f.addToPage(page, { x: x + 1, y: H - top - b.h * 0.75 + 1, width: b.w * 0.75 - 2, height: b.h * 0.75 - 2, borderWidth: 0 });
  }
  form.getTextField('zahtjev.ime').setText('Ivana Horvat');
  await save('bank-form-hr.pdf', await doc.save());
}

async function longDocument() {
  const pages = Array.from(
    { length: 100 },
    (_, i) => `<section style="break-after:page"><h1>Chapter ${i + 1}</h1>${Array.from({ length: 7 }, (_, k) => `<p>${para(3, i + k)}</p>`).join('')}</section>`,
  ).join('');
  const { pdf } = await chromePdf(pages);
  await save('long-100-pages.pdf', pdf);
}

async function scanned() {
  // A "scan": a page of text photographed as one JPEG, no text in the PDF.
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await page.setContent(`<style>${FONT_CSS} body{padding:76px;background:#f4f1ea}</style><h1>Scanned letter</h1><p>${para(4)}</p><p>${para(4, 2)}</p>`);
  await page.evaluate(() => document.fonts.ready);
  const jpg = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
  await browser.close();
  const doc = await PDFDocument.create();
  const p = doc.addPage([595.28, 841.89]);
  const img = await doc.embedJpg(jpg);
  p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  await save('scanned.pdf', await doc.save());
}

// --- pdf-lib ---------------------------------------------------------------------------------

async function rotatedPages() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const turn of [90, 180, 270]) {
    const p = doc.addPage([595.28, 841.89]);
    p.setRotation(degrees(turn));
    p.drawText(`Page turned ${turn} degrees`, { x: 60, y: 760, size: 18, font: bold });
    p.drawText(para(3), { x: 60, y: 720, size: 11, font, maxWidth: 470, lineHeight: 15 });
  }
  await save('rotated-pages.pdf', await doc.save());
}

async function rotatedText() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Upright heading', { x: 60, y: 770, size: 18, font });
  p.drawText('This line is turned thirty degrees', { x: 120, y: 520, size: 14, font, rotate: degrees(30) });
  p.drawText('This one runs up the page', { x: 520, y: 200, size: 14, font, rotate: degrees(90) });
  p.drawText('Upright footer line', { x: 60, y: 80, size: 11, font });
  await save('rotated-text.pdf', await doc.save());
}

async function textOutlines() {
  // Text drawn as filled shapes (as some exports do with "convert text to outlines"): no text to find.
  const doc = await PDFDocument.create();
  const p = doc.addPage([595.28, 841.89]);
  const f = fontkit.create(ARIMO) as any;
  const draw = (text: string, x: number, y: number, size: number) => {
    const run = f.layout(text);
    let pen = x;
    const k = size / f.unitsPerEm;
    for (let i = 0; i < run.glyphs.length; i++) {
      const path = run.glyphs[i].path.scale(1, -1).toSVG();
      if (path) p.drawSvgPath(path, { x: pen, y, scale: k, color: rgb(0.1, 0.12, 0.16) });
      pen += run.positions[i].xAdvance * k;
    }
  };
  draw('Outlined heading', 60, 760, 24);
  draw('These words are shapes, not text.', 60, 720, 12);
  await save('text-outlines.pdf', await doc.save());
}

async function type3() {
  // A Type3 font (glyphs drawn by small content streams), with a ToUnicode map.
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const letters = 'HELOTYPR';
  const procs = ctx.obj({}) as PDFDict;
  for (const ch of letters + ' ') {
    const name = ch === ' ' ? 'space' : ch;
    const body = ch === ' ' ? '500 0 d0' : '600 0 0 0 520 700 d1 40 0 80 700 re 40 620 440 80 re 40 310 360 70 re f';
    procs.set(PDFName.of(name), ctx.register(ctx.flateStream(body)));
  }
  const codes = [...(letters + ' ')].map((c) => c.charCodeAt(0));
  const first = Math.min(...codes);
  const last = Math.max(...codes);
  const widths = Array.from({ length: last - first + 1 }, (_, i) => (codes.includes(first + i) ? (first + i === 32 ? 500 : 600) : 0));
  const diffs: (number | PDFName)[] = [];
  for (const c of codes.sort((a, b) => a - b)) diffs.push(c, PDFName.of(c === 32 ? 'space' : String.fromCharCode(c)));
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T3 def 1 begincodespacerange <00> <FF> endcodespacerange ${codes.length} beginbfchar ${codes
    .map((c) => `<${c.toString(16).padStart(2, '0')}> <${c.toString(16).padStart(4, '0')}>`)
    .join(' ')} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const t3 = ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'Type3',
      FontBBox: [0, 0, 600, 700],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: procs,
      Encoding: ctx.obj({ Type: 'Encoding', Differences: diffs }),
      FirstChar: first,
      LastChar: last,
      Widths: widths,
      Resources: ctx.obj({}),
      ToUnicode: ctx.register(ctx.flateStream(cmap)),
    }),
  );
  const p = doc.addPage([595.28, 841.89]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  p.node.setFontDictionary(PDFName.of('T3'), t3);
  p.drawText('A caption in Helvetica under the Type3 line.', { x: 60, y: 700, size: 11, font: helv });
  p.node.addContentStream(ctx.register(ctx.flateStream('BT /T3 24 Tf 60 740 Td (HELLO TYPE THREE) Tj ET')));
  await save('type3-font.pdf', await doc.save());
}

async function formFields() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  const form = doc.getForm();
  p.drawText('Membership form', { x: 60, y: 770, size: 18, font });
  const rows = ['Full name', 'Email address', 'Member since'];
  rows.forEach((label, i) => {
    const y = 710 - i * 50;
    p.drawText(label, { x: 60, y: y + 22, size: 10, font });
    form.createTextField(`field${i}`).addToPage(p, { x: 60, y, width: 300, height: 18 });
  });
  p.drawText('I agree to the house rules', { x: 84, y: 560, size: 10, font });
  form.createCheckBox('agree').addToPage(p, { x: 60, y: 556, width: 14, height: 14 });
  form.getTextField('field0').setText('Ana Kovač');
  await save('form-fields.pdf', await doc.save());
}

async function signed() {
  // A real detached CMS signature (adbe.pkcs7.detached) over the whole file but the signature.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Signed agreement', { x: 60, y: 770, size: 18, font });
  p.drawText(para(2), { x: 60, y: 730, size: 11, font, maxWidth: 470, lineHeight: 15 });
  const ctx = doc.context;
  const SIG_LEN = 8192;
  const sig = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 1111111111, 2222222222, 3333333333],
    Contents: PDFHexString.of('0'.repeat(SIG_LEN * 2)),
    M: PDFString.fromDate(new Date('2026-03-01T10:00:00Z')),
    Name: PDFString.of('Blitz test signer'),
  });
  const sigRef = ctx.register(sig);
  const widget = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], V: sigRef, T: PDFString.of('Signature1'), F: 4, P: p.ref }),
  );
  p.node.set(PDFName.of('Annots'), ctx.obj([widget]));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [widget], SigFlags: 3 }));
  let bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  const text = bytes.toString('latin1');
  const start = text.indexOf('/Contents <') + '/Contents '.length;
  const end = text.indexOf('>', start) + 1;
  const range = [0, start, end, bytes.length - end];
  const brText = text.slice(text.indexOf('/ByteRange ['), text.indexOf(']', text.indexOf('/ByteRange [')) + 1);
  const brNew = `/ByteRange [${range.join(' ')}]`.padEnd(brText.length, ' ');
  bytes = Buffer.from(text.replace(brText, brNew), 'latin1');
  const dir = mkdtempSync(join(tmpdir(), 'sig-'));
  writeFileSync(join(dir, 'data.bin'), Buffer.concat([bytes.subarray(0, start), bytes.subarray(end)]));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '3650', '-subj', '/CN=Blitz test signer'], { stdio: 'ignore' });
  execFileSync('openssl', ['cms', '-sign', '-binary', '-in', join(dir, 'data.bin'), '-signer', join(dir, 'cert.pem'), '-inkey', join(dir, 'key.pem'), '-outform', 'DER', '-out', join(dir, 'sig.der')]);
  const der = readFileSync(join(dir, 'sig.der')).toString('hex');
  if (der.length > SIG_LEN * 2) throw new Error('signature too long');
  const out = Buffer.concat([bytes.subarray(0, start), Buffer.from(`<${der.padEnd(SIG_LEN * 2, '0')}>`, 'latin1'), bytes.subarray(end)]);
  await save('signed.pdf', out);
}

async function incremental() {
  // Revision 1 says "100 EUR"; an incremental update (appended) changes it to "120 EUR".
  // The old revision stays inside the file: a full rewrite must drop it.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Quote', { x: 60, y: 770, size: 18, font });
  p.drawText('Revision one: the price is 100 EUR, valid for thirty days.', { x: 60, y: 730, size: 11, font });
  const base = Buffer.from(await doc.save({ useObjectStreams: false }));
  const loaded = await PDFDocument.load(base);
  const page = loaded.getPage(0);
  const fontName = [...(page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict).keys())][0].asString();
  const ctx = loaded.context;
  const n = ctx.largestObjectNumber + 1;
  const stream = `BT ${fontName} 18 Tf 60 770 Td (Quote) Tj ET BT ${fontName} 11 Tf 60 730 Td (Revision two: the price is 120 EUR, valid for thirty days.) Tj ET`;
  const dict = page.node.clone();
  dict.set(PDFName.of('Contents'), PDFRef.of(n));
  const startxref = Number(/startxref\s+(\d+)/.exec(base.toString('latin1').slice(-64))![1]);
  let tail = '\n';
  const offStream = base.length + tail.length;
  tail += `${n} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  const offPage = base.length + tail.length;
  tail += `${page.ref.objectNumber} 0 obj\n${dict.toString()}\nendobj\n`;
  const offXref = base.length + tail.length;
  const pad = (o: number) => String(o).padStart(10, '0');
  tail += `xref\n0 1\n0000000000 65535 f \n${page.ref.objectNumber} 1\n${pad(offPage)} 00000 n \n${n} 1\n${pad(offStream)} 00000 n \n`;
  tail += `trailer\n<< /Size ${n + 1} /Root ${loaded.context.trailerInfo.Root} /Prev ${startxref} >>\nstartxref\n${offXref}\n%%EOF\n`;
  await save('incremental-update.pdf', Buffer.concat([base, Buffer.from(tail, 'latin1')]));
}

async function encrypted() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Read-only notice', { x: 60, y: 770, size: 18, font });
  p.drawText('This file opens without a password, but its permissions forbid changes.', { x: 60, y: 730, size: 11, font });
  doc.encrypt({ ownerPassword: 'owner-only-2026', userPassword: '', permissions: { modifying: false, annotating: false, fillingForms: false, documentAssembly: false, copying: true, printing: 'highResolution' } });
  await save('encrypted-no-modify.pdf', await doc.save());
}

async function taggedLeftovers() {
  // Text that lives on in other places: /ActualText, the structure tree (with /Alt),
  // marked content, a page thumbnail (/Thumb) and XMP metadata.
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('', { font }); // registers the font as /F1-ish on the page
  const fname = [...p.node.Resources()!.lookup(PDFName.of('Font'), PDFDict).keys()][0].asString();
  const content = [
    `/H1 <</MCID 0>> BDC BT ${fname} 18 Tf 60 770 Td (Visible heading) Tj ET EMC`,
    `/Span <</MCID 1 /ActualText (Confidential figure 4711)>> BDC BT ${fname} 12 Tf 60 730 Td (Shown words only) Tj ET EMC`,
    `/P <</MCID 2>> BDC BT ${fname} 11 Tf 60 700 Td (A last paragraph that stays.) Tj ET EMC`,
  ].join('\n');
  p.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  p.node.set(PDFName.of('StructParents'), PDFNumber.of(0));
  const root = ctx.nextRef();
  const elems = ['H1', 'Span', 'P'].map((type, i) =>
    ctx.register(ctx.obj({ Type: 'StructElem', S: type, P: root, Pg: p.ref, K: i, ...(type === 'Span' ? { Alt: PDFString.of('Confidential figure 4711') } : {}) })),
  );
  const parentTree = ctx.obj({ Nums: [0, ctx.obj(elems)] });
  ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: elems, ParentTree: parentTree, ParentTreeNextKey: 1 }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), root);
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
  // A tiny gray thumbnail.
  const thumb = ctx.stream(new Uint8Array(8 * 8 * 3).fill(200), { Width: 8, Height: 8, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
  p.node.set(PDFName.of('Thumb'), ctx.register(thumb));
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Confidential figure 4711</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
  await save('tagged-actualtext.pdf', await doc.save());
}

async function cidSubset() {
  // pdf-lib's own subset embedding: Type0 / CIDFontType2, Identity-H, with Croatian letters.
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(TINOS, { subset: true });
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Šećer, čaj i džem', { x: 60, y: 770, size: 18, font });
  p.drawText('Đak je žurio kroz dvorište, noseći čašu soka i kišobran.', { x: 60, y: 735, size: 12, font });
  p.drawText('Druga rečenica stoji u novom odlomku, nešto niže na stranici.', { x: 60, y: 700, size: 12, font });
  await save('cid-subset-croatian.pdf', await doc.save());
}

await chromeArticle();
await chromeCroatian();
await chromeColumns();
await chromeHard();
await bankForm();
await longDocument();
await scanned();
await rotatedPages();
await rotatedText();
await textOutlines();
await type3();
await formFields();
await signed();
await incremental();
await encrypted();
await taggedLeftovers();
await cidSubset();
