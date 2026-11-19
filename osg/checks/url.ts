// URL helpers shared by the checks: the comparison form page_checks.py uses
// to decide that two addresses name the same page.

const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', '_ga', 'ref']);
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

interface SplitUrl {
  scheme: string;
  netloc: string;
  path: string;
  params: string;
  query: string;
  fragment: string;
}

const RELATIVE_SCHEMES = new Set(['', 'ftp', 'http', 'gopher', 'nntp', 'imap', 'wais', 'file', 'https', 'shttp', 'mms', 'prospero', 'rtsp', 'rtsps', 'rtspu', 'sftp', 'svn', 'svn+ssh', 'ws', 'wss']);
const NETLOC_SCHEMES = new Set(['', 'ftp', 'http', 'gopher', 'nntp', 'telnet', 'imap', 'wais', 'file', 'mms', 'https', 'shttp', 'snews', 'prospero', 'rtsp', 'rtsps', 'rtspu', 'rsync', 'svn', 'svn+ssh', 'sftp', 'nfs', 'git', 'git+ssh', 'ws', 'wss', 'itms-services']);
const PARAM_SCHEMES = new Set(['', 'ftp', 'hdl', 'prospero', 'http', 'imap', 'https', 'shttp', 'rtsp', 'rtsps', 'rtspu', 'sip', 'sips', 'mms', 'sftp', 'tel']);
const SCHEME_CHARS = /^[A-Za-z][A-Za-z0-9+\-.]*$/;

/**
 * Python's urllib.parse.urlparse: the parts as written, nothing normalised
 * except a lower case scheme. Browsers tidy an address (lower case host,
 * escapes), and the facts and evidence show addresses the way the page wrote
 * them, as the script does.
 */
export function splitUrl(raw: string, defaultScheme = ''): SplitUrl {
  let url = raw.replace(/^[\x00-\x20]+/, '').replace(/[\t\r\n]/g, '');
  let scheme = defaultScheme;
  const colon = url.indexOf(':');
  if (colon > 0 && SCHEME_CHARS.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    url = url.slice(colon + 1);
  }
  let netloc = '';
  if (url.startsWith('//')) {
    let end = url.length;
    for (const stop of ['/', '?', '#']) {
      const at = url.indexOf(stop, 2);
      if (at >= 0) end = Math.min(end, at);
    }
    netloc = url.slice(2, end);
    url = url.slice(end);
  }
  let fragment = '';
  const hash = url.indexOf('#');
  if (hash >= 0) {
    fragment = url.slice(hash + 1);
    url = url.slice(0, hash);
  }
  let query = '';
  const question = url.indexOf('?');
  if (question >= 0) {
    query = url.slice(question + 1);
    url = url.slice(0, question);
  }
  let params = '';
  if (PARAM_SCHEMES.has(scheme) && url.includes(';')) {
    const at = url.includes('/') ? url.indexOf(';', url.lastIndexOf('/')) : url.indexOf(';');
    if (at >= 0) {
      params = url.slice(at + 1);
      url = url.slice(0, at);
    }
  }
  return { scheme, netloc, path: url, params, query, fragment };
}

function unsplit({ scheme, netloc, path, params, query, fragment }: SplitUrl): string {
  let url = params ? `${path};${params}` : path;
  if (netloc) {
    if (url && !url.startsWith('/')) url = `/${url}`;
    url = `//${netloc}${url}`;
  } else if (url.startsWith('//')) {
    url = `//${url}`;
  } else if (scheme && NETLOC_SCHEMES.has(scheme) && (!url || url.startsWith('/'))) {
    url = `//${url}`;
  }
  if (scheme) url = `${scheme}:${url}`;
  if (query) url = `${url}?${query}`;
  if (fragment) url = `${url}#${fragment}`;
  return url;
}

/** `href` read against `base` the way Python's urljoin does it. */
export function joinUrl(base: string, href: string): string {
  if (!base) return href;
  if (!href) return base;
  const b = splitUrl(base);
  const u = splitUrl(href, b.scheme);
  if (u.scheme !== b.scheme || !RELATIVE_SCHEMES.has(u.scheme)) return href;
  let { netloc } = u;
  if (NETLOC_SCHEMES.has(u.scheme)) {
    if (netloc) return unsplit(u);
    netloc = b.netloc;
  }
  if (!u.path && !u.params) {
    return unsplit({ ...u, netloc, path: b.path, params: b.params, query: u.query || b.query });
  }
  const baseParts = b.path.split('/');
  if (baseParts[baseParts.length - 1] !== '') baseParts.pop();
  let segments: string[];
  if (u.path.startsWith('/')) {
    segments = u.path.split('/');
  } else {
    segments = [...baseParts, ...u.path.split('/')];
    if (segments.length > 2) segments = [segments[0], ...segments.slice(1, -1).filter(Boolean), segments[segments.length - 1]];
  }
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '..') resolved.pop();
    else if (segment !== '.') resolved.push(segment);
  }
  const last = segments[segments.length - 1];
  if (last === '.' || last === '..') resolved.push('');
  return unsplit({ ...u, netloc, path: resolved.join('/') || '/' });
}

/** The scheme and the host (lower case, no port) of an address, as Python's urlparse gives them. */
export function schemeAndHost(url: string): { scheme: string; host: string } {
  const { scheme, netloc } = splitUrl(url);
  const hostPort = netloc.includes('@') ? netloc.slice(netloc.lastIndexOf('@') + 1) : netloc;
  let host = hostPort;
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']') > 0 ? host.indexOf(']') : undefined);
  else if (host.includes(':')) host = host.slice(0, host.indexOf(':'));
  return { scheme, host: host.toLowerCase() };
}

function utf8Escapes(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out += ch;
      continue;
    }
    for (const byte of new TextEncoder().encode(ch)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * One spelling for the percent-encoding of a path or query (RFC 3986, 6.2.2):
 * "%c3%a9", "%C3%A9" and a literal "é" all become "%C3%A9", and the escape of
 * an unreserved character becomes the character. Escapes of reserved
 * characters keep their meaning.
 */
export function oneEscapeSpelling(part: string): string {
  const spelled = part.replace(/%([0-9A-Fa-f]{2})/g, (whole, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(ch) ? ch : whole.toUpperCase();
  });
  return /^[\x00-\x7f]*$/.test(spelled) ? spelled : utf8Escapes(spelled);
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The comparison form of an address: lower case host (browsers already give
 * Punycode), no fragment, no tracking parameters, one spelling for escapes.
 * Null for anything that is not an http or https address.
 */
export function canonicalizeUrl(url: string): string | null {
  if (!url || /\s/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if ((scheme !== 'http' && scheme !== 'https') || !parsed.hostname) return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const netloc = parsed.port ? `${host}:${parsed.port}` : host;
  const path = oneEscapeSpelling((parsed.pathname || '/').replace(/\/{2,}/g, '/'));
  const kept: string[] = [];
  for (const pair of parsed.search.replace(/^\?/, '').split('&')) {
    if (!pair) continue;
    const key = safeDecode(pair.split('=', 1)[0]).toLowerCase();
    if (key.startsWith('utm_') || TRACKING_KEYS.has(key)) continue;
    kept.push(oneEscapeSpelling(pair));
  }
  return `${scheme}://${netloc}${path}${kept.length ? `?${kept.join('&')}` : ''}`;
}

/** The key for deciding two addresses name the same page: a trailing slash makes no difference. */
export function urlMatchKey(url: string): string {
  const canonical = canonicalizeUrl(url);
  if (canonical === null) return url;
  const parsed = new URL(canonical);
  let path = parsed.pathname;
  if (path !== '/' && path.endsWith('/')) path = path.replace(/\/+$/, '') || '/';
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}

/** The site's root ("https://example.com"), with no slash at the end. */
export function siteRoot(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}
