// Dropping objects nothing refers to any more (pdf-lib writes every object it holds).
import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib';

/** pdf-lib writes every object it holds, reachable or not. Remove the unreachable ones. */
export function collectGarbage(doc: PDFDocument) {
  const { context } = doc;
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const o of [Root, Info, Encrypt]) if (o) stack.push(o);

  while (stack.length) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (const v of obj.asArray()) stack.push(v);
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }

  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) context.delete(ref);
  }
}

