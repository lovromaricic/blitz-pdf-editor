import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assemble, isWinAnsi } from '../src/lib/pdf/assemble';
import { createFontProvider } from '../src/lib/pdf/font-provider';
import { changedFieldValues, hasFormFields, type FieldValue } from '../src/lib/forms';

const fonts = createFontProvider(async () =>
  new Uint8Array(readFileSync('node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf')),
);

async function formPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  form.createTextField('name').addToPage(page, { x: 100, y: 700, width: 300, height: 24 });
  form.createCheckBox('agree').addToPage(page, { x: 100, y: 650, width: 18, height: 18 });
  const plan = form.createRadioGroup('plan');
  plan.addOptionToPage('basic', page, { x: 100, y: 600, width: 16, height: 16 });
  plan.addOptionToPage('pro', page, { x: 150, y: 600, width: 16, height: 16 });
  const country = form.createDropdown('country');
  country.addOptions(['Croatia', 'Germany']);
  country.addToPage(page, { x: 100, y: 550, width: 200, height: 24 });
  return doc.save();
}

const values: FieldValue[] = [
  { name: 'name', kind: 'text', value: 'Đurđica Čačić' },
  { name: 'agree', kind: 'checkbox', value: true },
  { name: 'plan', kind: 'radio', value: 'pro' },
  { name: 'country', kind: 'choice', value: 'Croatia' },
];

describe('form filling', () => {
  it('writes filled-in values that other readers see', async () => {
    const out = await assemble([{ id: 'f', bytes: await formPdf() }], [{ sourceId: 'f', index: 0, rotation: 0 }], 'preserve', {
      fonts,
      forms: { f: values },
    });
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField('name').getText()).toBe('Đurđica Čačić');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
    expect(form.getRadioGroup('plan').getSelected()).toBe('pro');
    expect(form.getDropdown('country').getSelected()).toEqual(['Croatia']);

    // PDF.js (another reader) sees the same values.
    const pdf = await getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const widgets = (await (await pdf.getPage(1)).getAnnotations()) as { fieldName?: string; fieldValue?: unknown }[];
    expect(widgets.find((w) => w.fieldName === 'name')?.fieldValue).toBe('Đurđica Čačić');
    expect(widgets.find((w) => w.fieldName === 'plan' && w.fieldValue === 'pro')).toBeTruthy();
    await pdf.loadingTask.destroy();
  });

  it('knows which text the standard fonts can show', () => {
    expect(isWinAnsi('Café – “quoted” €5, Šime Žagar')).toBe(true);
    expect(isWinAnsi('Đurđica')).toBe(false);
    expect(isWinAnsi('Čačić')).toBe(false);
    expect(isWinAnsi('Привет')).toBe(false);
  });

  it('flattens fields into page content, keeping non-Latin-1 letters', async () => {
    const out = await assemble([{ id: 'f', bytes: await formPdf() }], [{ sourceId: 'f', index: 0, rotation: 0 }], 'preserve', {
      fonts,
      forms: { f: values },
      flatten: ['f'],
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    // The flattened name must read back exactly (no "?" substitutions).
    const pdf = await getDocument({ data: out.slice(), isEvalSupported: false } as never).promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(text).toContain('Đurđica Čačić');
    await pdf.loadingTask.destroy();
  });

  it('leaves forms untouched when nothing was filled in', async () => {
    const out = await assemble([{ id: 'f', bytes: await formPdf() }], [{ sourceId: 'f', index: 0, rotation: 0 }], 'preserve', { fonts });
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField('name').getText()).toBeUndefined();
    expect(form.getFields()).toHaveLength(4);
  });
});

describe('reading what the user typed (PDF.js storage)', () => {
  it('collects changed text, checkbox, radio and choice values', async () => {
    const pdf = await getDocument({ data: await formPdf(), isEvalSupported: false } as never).promise;
    const widgets = (await (await pdf.getPage(1)).getAnnotations()) as { id: string; fieldName: string; buttonValue?: string }[];
    const id = (name: string, button?: string) => widgets.find((w) => w.fieldName === name && (!button || w.buttonValue === button))!.id;
    expect(await changedFieldValues(pdf)).toEqual([]);

    const storage = pdf.annotationStorage;
    storage.setValue(id('name'), { value: 'Ana' });
    storage.setValue(id('agree'), { value: true });
    storage.setValue(id('plan', 'basic'), { value: false });
    storage.setValue(id('plan', 'pro'), { value: true });
    storage.setValue(id('country'), { value: 'Germany' });

    expect(await changedFieldValues(pdf)).toEqual([
      { name: 'name', kind: 'text', value: 'Ana' },
      { name: 'agree', kind: 'checkbox', value: true },
      { name: 'plan', kind: 'radio', value: 'pro' },
      { name: 'country', kind: 'choice', value: 'Germany' },
    ]);
    await pdf.loadingTask.destroy();
  });
});

/** Page text as other readers extract it. */
async function pageText(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false } as never).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
  await pdf.loadingTask.destroy();
  return text;
}

describe('Flatten / lock form', () => {
  it('knows a plain PDF has no fillable fields, and a form has', async () => {
    const plain = await PDFDocument.create();
    plain.addPage();
    const none = await getDocument({ data: await plain.save(), isEvalSupported: false } as never).promise;
    expect(await hasFormFields(none)).toBe(false);
    await none.loadingTask.destroy();
    const form = await getDocument({ data: await formPdf(), isEvalSupported: false } as never).promise;
    expect(await hasFormFields(form)).toBe(true);
    await form.loadingTask.destroy();
  });

  it('removes every form field but keeps all values as page content', async () => {
    const out = await assemble([{ id: 'f', bytes: await formPdf() }], [{ sourceId: 'f', index: 0, rotation: 0 }], 'preserve', {
      fonts,
      forms: { f: values },
      flatten: ['f'],
    });
    const doc = await PDFDocument.load(out);
    // No form left: no AcroForm at all, no widget annotations on the page.
    expect(doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)).toBeUndefined();
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    // The values are now page content (text and dropdown as text; check and radio drawn).
    const text = await pageText(out);
    expect(text).toContain('Đurđica Čačić');
    expect(text).toContain('Croatia');
    const resources = doc.getPage(0).node.Resources()!;
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
    // One drawn appearance per widget: text, checkbox, two radio buttons, dropdown.
    expect(xobjects?.keys().length).toBeGreaterThanOrEqual(5);
  });

  it('keeps values filled in by another app (no drawn appearance), Croatian letters included', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    form.createTextField('name').addToPage(page, { x: 100, y: 700, width: 300, height: 24 });
    form.createTextField('empty').addToPage(page, { x: 100, y: 650, width: 300, height: 24 });
    const field = form.getTextField('name');
    field.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('Šime Čačić'));
    field.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), doc.context.obj(true));
    // An unsigned signature field, as many forms have.
    const sig = doc.context.obj({ FT: 'Sig', Type: 'Annot', Subtype: 'Widget', Rect: [100, 100, 300, 140], F: 4, P: page.ref });
    sig.set(PDFName.of('T'), PDFString.of('signature'));
    const sigRef = doc.context.register(sig);
    page.node.addAnnot(sigRef);
    form.acroForm.addField(sigRef);
    const bytes = await doc.save({ updateFieldAppearances: false });

    const out = await assemble([{ id: 'f', bytes }], [{ sourceId: 'f', index: 0, rotation: 0 }], 'preserve', { fonts, forms: { f: [] }, flatten: ['f'] });
    expect((await PDFDocument.load(out)).catalog.has(PDFName.of('AcroForm'))).toBe(false);
    expect((await pageText(out)).trim()).toBe('Šime Čačić');
  });
});
