// Links in text boxes: which addresses are allowed, how typed addresses are
// cleaned up, and finding a web address just typed. Nothing here touches the
// network: addresses are only parsed (the URL API, no lookups or previews).
import type { TextLink } from './annotations';

/** Schemes a link may use. Everything else (javascript:, data:, file:, ftp:, …) is refused. */
const ALLOWED = new Set(['http:', 'https:', 'mailto:', 'tel:']);
/** Longer addresses are refused (some PDF viewers truncate or reject them). */
export const MAX_URL_LENGTH = 2048;

export type UrlCheck = { ok: true; href: string } | { ok: false; error: string };

export const LINK_ERRORS = {
  empty: 'Enter a web address or an email address.',
  scheme: 'Only web (http, https), email (mailto) and phone (tel) links are allowed.',
  invalid: "This doesn't look like a web or email address.",
  spaces: "Web addresses can't contain spaces.",
  long: `Use an address shorter than ${MAX_URL_LENGTH} characters.`,
};

// A scheme (letters, digits, + . -), as browsers read it. "example.com:8080" is a host and port, not a scheme.
const SCHEME = /^([a-z][a-z\d+.-]*):/i;
const HOST_PORT = /^[^\s/:?#@]+:\d+(?:[/?#]|$)/;
const EMAIL = /^[^\s@/:?#]+@[^\s@/:?#]+\.[^\s@/:?#.]+$/;
// Telephone numbers: digits with the usual separators, an optional leading +.
const PHONE = /^\+?[\d\s().-]*\d[\d\s().-]*$/;

/**
 * Clean up an address as typed: trim it, add https:// to a bare domain and
 * mailto: to a bare email address, and refuse anything that isn't a web,
 * email or phone link. The result is ASCII (international domain names in
 * punycode), as PDF link actions need, and shows the real domain.
 */
export function normalizeUrl(input: string): UrlCheck {
  // Browsers ignore tabs and line breaks inside addresses ("java\tscript:" is javascript:), so do we.
  const s = input.replace(/[\t\n\r]/g, '').trim();
  if (!s) return { ok: false, error: LINK_ERRORS.empty };
  if (s.length > MAX_URL_LENGTH) return { ok: false, error: LINK_ERRORS.long };
  if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: LINK_ERRORS.invalid };

  const scheme = HOST_PORT.test(s) ? null : SCHEME.exec(s)?.[1].toLowerCase();
  let candidate: string;
  if (scheme) {
    if (!ALLOWED.has(`${scheme}:`)) return { ok: false, error: LINK_ERRORS.scheme };
    candidate = s;
  } else if (s.startsWith('//')) {
    candidate = `https:${s}`;
  } else if (EMAIL.test(s)) {
    candidate = `mailto:${s}`;
  } else {
    candidate = `https://${s}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: /\s/.test(s) ? LINK_ERRORS.spaces : LINK_ERRORS.invalid };
  }
  // Check again after parsing: the parser decides the scheme, not our regex.
  if (!ALLOWED.has(url.protocol)) return { ok: false, error: LINK_ERRORS.scheme };

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (/\s/.test(s)) return { ok: false, error: LINK_ERRORS.spaces };
    const host = url.hostname;
    // A domain with a dot (example.com), localhost, or an IP address.
    // A domain ending in a name (example.com, bücher.de), localhost, or an IP address written
    // out in full: the parser would read "1.5" as the address 1.0.0.5.
    const typed = candidate.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].replace(/:\d*$/, '');
    const domain = /\.[\p{L}][\p{L}\p{N}-]+\.?$/u.test(typed) && !/^\.|\.\./.test(typed);
    const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(typed);
    if (!host || !(domain || ipv4 || typed.toLowerCase() === 'localhost' || typed.startsWith('['))) return { ok: false, error: LINK_ERRORS.invalid };
    // No passwords in links: they would be saved in the PDF for anyone to read.
    if (url.username || url.password) return { ok: false, error: LINK_ERRORS.invalid };
  } else if (url.protocol === 'mailto:') {
    const address = decodeURIComponent(url.pathname.split('?')[0]);
    if (!EMAIL.test(address)) return { ok: false, error: LINK_ERRORS.invalid };
  } else if (url.protocol === 'tel:') {
    const number = decodeURIComponent(url.pathname);
    if (!PHONE.test(number)) return { ok: false, error: LINK_ERRORS.invalid };
    return { ok: true, href: `tel:${number.replace(/[\s().-]/g, '')}` };
  }
  const href = url.href;
  if (href.length > MAX_URL_LENGTH) return { ok: false, error: LINK_ERRORS.long };
  return { ok: true, href };
}

/** Is this stored or received address one we would open? (Checked again before every open.) */
export function isSafeHref(href: string): boolean {
  try {
    // It must already carry an allowed scheme (no guessing here), and pass the same checks as typed ones.
    return ALLOWED.has(new URL(href).protocol) && normalizeUrl(href).ok;
  } catch {
    return false;
  }
}

/** How a link is shown in the editor's popovers: the address (punycode domain) or "Page 3". */
export function linkTarget(link: TextLink, pageNumber: (pageId: string) => number | null): string {
  if (link.kind === 'url') return link.href.replace(/^mailto:/, '').replace(/^tel:/, '');
  const n = pageNumber(link.pageId);
  return n === null ? 'A deleted page' : `Page ${n}`;
}

/**
 * Open a web, email or phone link in a new tab, with no access back to this
 * tab and no referrer. Refuses anything not allowed. Returns whether it opened.
 */
export function openExternal(href: string): boolean {
  if (!isSafeHref(href)) return false;
  const w = window.open(href, '_blank', 'noopener,noreferrer');
  if (w) w.opener = null;
  return true;
}

// --- Automatic links: an address just typed (or pasted) before a space or Enter ------------------

// Endings that are usually punctuation after an address, not part of it.
const TRAILING = /[.,;:!?'"’”)\]}>]+$/;
// Bare names that look like domains but are usually files.
const FILE_ENDINGS = new Set(
  'txt pdf doc docx xls xlsx ppt pptx csv png jpg jpeg gif svg webp heic tif tiff bmp zip rar gz tar mp3 mp4 mov avi wav json xml yml yaml js ts css html htm exe dmg pkg rtf odt ods odp key pages numbers'.split(' '),
);

/**
 * The address at the end of `text` (the paragraph's text up to the caret), if
 * any: its start and end within `text`, and where it links. Trailing
 * punctuation is left out ("see example.com." links example.com).
 */
export function trailingUrl(text: string): { from: number; to: number; href: string } | null {
  const word = /\S+$/.exec(text);
  if (!word) return null;
  let token = word[0];
  const from = word.index;
  // Leading brackets or quotes aren't part of it either.
  const lead = /^[('"‘“<[{]+/.exec(token)?.[0].length ?? 0;
  token = token.slice(lead).replace(TRAILING, '');
  // Keep a closing bracket that belongs to the address, e.g. a Wikipedia page "Foo_(bar)".
  const rest = word[0].slice(lead + token.length);
  if (rest.startsWith(')') && token.includes('(') && !token.includes(')')) token += ')';
  if (!looksLikeAddress(token)) return null;
  const check = normalizeUrl(token);
  if (!check.ok) return null;
  return { from: from + lead, to: from + lead + token.length, href: check.href };
}

function looksLikeAddress(token: string): boolean {
  if (token.length < 4) return false;
  if (/^(https?:\/\/|mailto:)/i.test(token)) return true;
  if (/^www\./i.test(token)) return token.length > 4;
  if (EMAIL.test(token)) return true;
  // A bare domain: name.tld, optionally a path. The ending must be letters (not "1.5") and not a file type.
  const m = /^([a-z\d-]+(?:\.[a-z\d-]+)*\.([a-z]{2,24}))(?::\d+)?(?:[/?#]\S*)?$/i.exec(token);
  if (!m) return false;
  return !FILE_ENDINGS.has(m[2].toLowerCase());
}
