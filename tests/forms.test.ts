import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assemble, isWinAnsi } from '../src/lib/pdf/assemble';
import { createFontProvider } from '../src/lib/pdf/font-provider';
import { changedFieldValues, type FieldValue } from '../src/lib/forms';

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
