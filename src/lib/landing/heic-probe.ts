// Can this browser decode HEIC? (Safari can; Chrome and Firefox can't.) Decodes a
// tiny 2x2 HEIC with createImageBitmap. Loaded lazily, after first paint.
const SAMPLE = 'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABh21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOdpcHJwAAAAxmlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcmh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAJEIBAQNwAAADALAAAAMAAAMAHqAUIEHAoQQYh7kWVTcCAgYAgKIAAQAJRAHAYXLIQFMkAAAAGWlwbWEAAAAAAAAAAQABBoECAwWGhAAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAG7AAAAPwAAAAFtZGF0AAAAAAAAAE8AAAA7KAGvo18RlYOks8JirQbL8J+iyr//+nNAELPHO3v/7JYAD+1x8D8H84kQNpk9wypHHr/f26A0pw2GWDU=';

let result: Promise<boolean> | null = null;

export function heicDecodes(): Promise<boolean> {
  result ??= (async () => {
    if (typeof createImageBitmap === 'undefined') return false;
    try {
      const bytes = Uint8Array.from(atob(SAMPLE), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/heic' }));
      const ok = bitmap.width === 2 && bitmap.height === 2;
      bitmap.close();
      return ok;
    } catch {
      return false;
    }
  })();
  return result;
}
