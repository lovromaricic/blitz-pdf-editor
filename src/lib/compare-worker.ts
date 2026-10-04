// Runs the word diff for Compare off the UI thread (long documents can take a while).
import { computeHunks } from './compare-diff';

self.onmessage = (e: MessageEvent<{ a: string[]; b: string[] }>) => {
  (self as unknown as Worker).postMessage(computeHunks(e.data.a, e.data.b));
};
