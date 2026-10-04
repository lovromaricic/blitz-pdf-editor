/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module 'virtual:licenses' {
  const list: { name: string; version: string; license: string }[];
  export default list;
}

declare module '*.ttf?url' {
  const url: string;
  export default url;
}

declare module 'virtual:font-previews' {
  /** Font id → its name drawn in its own typeface, as an SVG path (font units, baseline at y = 0). */
  const previews: Record<string, { d: string; box: [number, number, number, number]; em: number }>;
  export default previews;
}
