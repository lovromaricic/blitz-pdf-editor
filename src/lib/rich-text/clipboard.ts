// Copy and paste for the rich text editor. Formatted text moves between our
// own text boxes through memory only: the system clipboard gets the plain
// text and a marker, never the formatting. Everything from outside (another
// app, a web page) is pasted as plain text: HTML is never parsed into content.
//
// The marker travels in a custom type where the browser keeps it, and in the
// HTML flavour (a single <meta> tag around the escaped plain text), because
// Chrome drops custom types on the way through the system clipboard.
import type { Slice } from 'prosemirror-model';

/** Clipboard type of the marker that says "this copy came from a Blitz text box". */
export const RICH_MARK = 'application/x-blitz-rich-text';

let stored: { id: string; slice: Slice; text: string } | null = null;
let counter = 0;

/** Keep a copied slice; returns the marker id to put on the system clipboard. */
export function rememberCopy(slice: Slice, text: string): string {
  stored = { id: `rich-${Date.now().toString(36)}-${++counter}`, slice, text };
  return stored.id;
}

/**
 * The formatted slice to paste, if the clipboard still holds our copy (same
 * marker and same text). Otherwise null: paste the plain text.
 */
export function copiedSlice(marker: string | null | undefined, text: string): Slice | null {
  if (!stored || !marker || marker !== stored.id) return null;
  return text.replace(/\r\n?/g, '\n') === stored.text ? stored.slice : null;
}

export function forgetCopy() {
  stored = null;
}

const META = 'blitz-rich-text';

/** The HTML flavour of a copy: the plain text, escaped, with our marker. */
export function markerHtml(id: string, text: string): string {
  const esc = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<meta name="${META}" content="${id}"><span>${esc.replace(/\n/g, '<br>')}</span>`;
}

/** Our marker in pasted HTML, if any (the HTML is only searched, never used). */
export function markerFromHtml(html: string): string | null {
  return new RegExp(`<meta name="${META}" content="(rich-[a-z0-9-]+)"`).exec(html)?.[1] ?? null;
}
