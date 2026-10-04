// Plain-language error messages. Tiny on purpose: the Home screen imports it.

/** Turn low-level failures into something a person can act on. */
export function friendlyError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof RangeError || /allocation failed|out of memory|Array buffer/i.test(message)) {
    return 'This device ran out of memory. Close other tabs or apps, or try with a smaller file.';
  }
  if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) {
    return 'Part of the app could not be loaded. If the app was just updated, reload the page (save your work first if you can).';
  }
  return message || 'Something went wrong.';
}
