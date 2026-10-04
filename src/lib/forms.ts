// Form fields: what the user typed lives in PDF.js's annotation storage while
// editing; on save it is read out here and written into the PDF by pdf-lib.
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'choice';

/** A changed field value, plain data so it can go to the worker. */
export interface FieldValue {
  name: string;
  kind: FieldKind;
  value: string | boolean | string[];
}

interface FieldObject {
  id: string;
  type: string;
  /** 0-based page index of this widget. */
  page: number;
}

const FILLABLE = new Set(['text', 'checkbox', 'radiobutton', 'combobox', 'listbox']);

/**
 * Widgets by full field name (PDF.js returns a plain object or a Map, depending
 * on version). Parent field entries without a type are dropped.
 */
export async function fieldObjects(pdf: PDFDocumentProxy): Promise<[string, FieldObject[]][]> {
  const fields = (await pdf.getFieldObjects()) as unknown;
  if (!fields) return [];
  const entries = fields instanceof Map ? [...fields.entries()] : Object.entries(fields as Record<string, FieldObject[]>);
  return entries.map(([name, list]) => [name, (list as FieldObject[]).filter((w) => w.type)] as [string, FieldObject[]]);
}

export async function hasFormFields(pdf: PDFDocumentProxy) {
  return (await fieldObjects(pdf)).some(([, widgets]) => widgets.some((w) => FILLABLE.has(w.type)));
}

/** Values the user changed in this document's form fields. */
export async function changedFieldValues(pdf: PDFDocumentProxy): Promise<FieldValue[]> {
  const storage = pdf.annotationStorage;
  if (storage.size === 0) return [];
  const out: FieldValue[] = [];
  for (const [name, widgets] of await fieldObjects(pdf)) {
    const raw = (id: string) => (storage.getRawValue(id) as { value?: unknown } | undefined)?.value;
    const type = widgets[0]?.type;
    if (type === 'text') {
      const v = widgets.map((w) => raw(w.id)).find((x) => x !== undefined);
      if (typeof v === 'string') out.push({ name, kind: 'text', value: v });
    } else if (type === 'checkbox') {
      const v = widgets.map((w) => raw(w.id)).find((x) => x !== undefined);
      if (typeof v === 'boolean') out.push({ name, kind: 'checkbox', value: v });
    } else if (type === 'radiobutton') {
      const on = widgets.find((w) => raw(w.id) === true);
      // The chosen option's export value is on its widget annotation.
      const value = on && (await widgetData(pdf, on))?.buttonValue;
      if (typeof value === 'string') out.push({ name, kind: 'radio', value });
    } else if (type === 'combobox' || type === 'listbox') {
      const v = widgets.map((w) => raw(w.id)).find((x) => x !== undefined);
      if (typeof v === 'string' || Array.isArray(v)) out.push({ name, kind: 'choice', value: v as string | string[] });
    }
  }
  return out;
}

async function widgetData(pdf: PDFDocumentProxy, w: FieldObject) {
  if (w.page < 0) return undefined;
  const annots = (await (await pdf.getPage(w.page + 1)).getAnnotations()) as { id: string; buttonValue?: unknown }[];
  return annots.find((a) => a.id === w.id);
}
