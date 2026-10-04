/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module 'virtual:licenses' {
  const list: { name: string; version: string; license: string }[];
  export default list;
}
