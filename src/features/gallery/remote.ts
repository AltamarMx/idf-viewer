/**
 * Opening an IDF from a web address (A6): `?url=…` on the viewer's own address, the
 * "Open from a URL" field of the start page, or an example of the gallery. The browser
 * downloads the file straight from that server, which must let other sites read it (CORS);
 * nothing passes through a server of the viewer.
 */
import type { FileSource } from '../../core/session';

/**
 * The `url` parameter of the viewer's address, or null. Everything after `url=` is the
 * address, so a link written by hand works even when the file's address has `&` in it. An
 * address without `/` was percent-encoded and is decoded.
 */
export function urlParameter(search: string): string | null {
  let value = /[?&]url=(.*)$/s.exec(search)?.[1];
  if (value === undefined) return null;
  if (!value.includes('/')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep it as written; downloadUrl reports it if it is not an address.
    }
  }
  value = value.trim();
  return value || null;
}

/**
 * The viewer's address `here` with `?url=` set to `url` (written as is, so the link stays
 * readable), or without it when `url` is null.
 */
export function viewerLink(here: string, url: string | null): string {
  const link = new URL(here);
  link.search = '';
  link.hash = '';
  if (!url) return link.href;
  return `${link.href}?url=${url.replace(/#.*$/s, '').replace(/\s/g, encodeURIComponent)}`;
}

/**
 * The address to download `url` from. Relative addresses are resolved against `base` (the
 * viewer's own folder, so `examples/…` works), and pages of GitHub and Gist become their raw
 * file, the only GitHub addresses that let other sites read them.
 */
export function downloadUrl(url: string, base: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim(), base);
  } catch {
    throw new Error('this is not a web address');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('the address must start with https://');
  }
  parsed.hash = '';
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);
  // github.com/{owner}/{repo}/blob/{branch or commit}/{path} and …/raw/…
  if (
    (host === 'github.com' || host === 'www.github.com') &&
    parts.length >= 5 &&
    (parts[2] === 'blob' || parts[2] === 'raw')
  ) {
    const [owner, repo, , ...rest] = parts;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join('/')}`;
  }
  // gist.github.com/{user}/{id} (its first file) and gist.github.com/{user}/{id}/raw/…
  if (host === 'gist.github.com' && parts.length >= 2) {
    if (parts.length === 2) return `https://gist.githubusercontent.com/${parts.join('/')}/raw`;
    if (parts[2] === 'raw') return `https://gist.githubusercontent.com/${parts.join('/')}`;
  }
  return parsed.href;
}

/** The file name to show for a download address: its last path segment, or the server. */
export function fileNameOf(address: string): string {
  try {
    const parsed = new URL(address);
    const last = parsed.pathname.split('/').filter(Boolean).at(-1);
    if (last && last !== 'raw') {
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    }
    return parsed.hostname;
  } catch {
    return address;
  }
}

/** The name to show while `url` is opened; never throws. */
export function displayName(url: string, base: string): string {
  try {
    return fileNameOf(downloadUrl(url, base));
  } catch {
    return url;
  }
}

const STATUS: Record<number, string> = {
  401: 'sign-in required',
  403: 'access denied',
  404: 'not found',
  410: 'no longer there',
  429: 'too many requests',
};

/** Downloads `url` (see downloadUrl) and returns it ready for the worker. */
export async function downloadIdf(url: string, base: string): Promise<FileSource> {
  const address = downloadUrl(url, base);
  if (new URL(base).protocol === 'https:' && address.startsWith('http:')) {
    throw new Error(
      'the browser does not let a secure page (https) download from an http:// address. ' +
        'Try the same address with https://',
    );
  }
  let response: Response;
  try {
    response = await fetch(address);
  } catch {
    throw new Error(
      'the download failed. The server may not let other sites read its files (CORS), ' +
        'the address may be wrong, or there may be no internet connection',
    );
  }
  if (!response.ok) {
    const meaning = STATUS[response.status];
    throw new Error(`the server answered ${response.status}${meaning ? ` (${meaning})` : ''}`);
  }
  const buffer = await response.arrayBuffer();
  if (isWebPage(buffer)) {
    throw new Error(
      'the address returned a web page, not an IDF or epJSON file. ' +
        'Use the address of the file itself (on GitHub, its "Raw" link)',
    );
  }
  return { name: fileNameOf(address), buffer };
}

/** An IDF never starts with `<`; a web page does. */
function isWebPage(buffer: ArrayBuffer): boolean {
  const head = new TextDecoder().decode(
    new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength)),
  );
  return head.trimStart().startsWith('<');
}
