// "Mixed" in the editor's selection formats. Its own module so the Text panel
// can use it without loading the editor (ProseMirror loads on first edit).
export const MIXED = 'mixed' as const;
export type Value<T> = T | typeof MIXED;
