/**
 * Opening a file from a web address (A6).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  displayName,
  downloadIdf,
  downloadUrl,
  fileNameOf,
  urlParameter,
  viewerLink,
} from '../src/features/gallery/remote';

const BASE = 'https://altamarmx.github.io/idf-viewer/';
const RAW =
  'https://raw.githubusercontent.com/NREL/EnergyPlus/develop/testfiles/1ZoneUncontrolled.idf';

describe('the url parameter', () => {
  it('takes everything after url=, written as is or percent-encoded', () => {
    expect(urlParameter('')).toBeNull();
    expect(urlParameter('?other=1')).toBeNull();
    expect(urlParameter('?url=')).toBeNull();
    expect(urlParameter(`?url=${RAW}`)).toBe(RAW);
    expect(urlParameter(`?url=${encodeURIComponent(RAW)}`)).toBe(RAW);
    expect(urlParameter('?url=https://example.org/get?file=a.idf&rev=2')).toBe(
      'https://example.org/get?file=a.idf&rev=2',
    );
    expect(urlParameter('?x=1&url=examples/1ZoneUncontrolled.idf')).toBe(
      'examples/1ZoneUncontrolled.idf',
    );
  });

  it('round-trips through the viewer link', () => {
    const link = viewerLink(
      `${BASE}?url=old.idf#x`,
      'https://example.org/get?file=a.idf&rev=2#top',
    );
    expect(link).toBe(`${BASE}?url=https://example.org/get?file=a.idf&rev=2`);
    expect(urlParameter(new URL(link).search)).toBe('https://example.org/get?file=a.idf&rev=2');
    expect(viewerLink(`${BASE}?url=old.idf`, null)).toBe(BASE);
    const spaced = viewerLink(BASE, 'https://example.org/my model.idf');
    expect(urlParameter(new URL(spaced).search)).toBe('https://example.org/my%20model.idf');
  });
});

describe('the download address', () => {
  it('turns GitHub and Gist pages into their raw file', () => {
    const page = 'https://github.com/NREL/EnergyPlus/blob/develop/testfiles/1ZoneUncontrolled.idf';
    expect(downloadUrl(page, BASE)).toBe(RAW);
    expect(downloadUrl(`${page}?plain=1#L10`, BASE)).toBe(RAW);
    expect(downloadUrl(page.replace('/blob/', '/raw/'), BASE)).toBe(RAW);
    expect(
      downloadUrl('https://github.com/o/r/blob/refs/heads/main/dir/My%20model.idf', BASE),
    ).toBe('https://raw.githubusercontent.com/o/r/refs/heads/main/dir/My%20model.idf');
    expect(downloadUrl(RAW, BASE)).toBe(RAW);
    // A repository page is not a file and is left alone.
    expect(downloadUrl('https://github.com/NREL/EnergyPlus', BASE)).toBe(
      'https://github.com/NREL/EnergyPlus',
    );
    expect(downloadUrl('https://gist.github.com/someone/abc123', BASE)).toBe(
      'https://gist.githubusercontent.com/someone/abc123/raw',
    );
    expect(downloadUrl('https://gist.github.com/someone/abc123/raw/f00/model.idf', BASE)).toBe(
      'https://gist.githubusercontent.com/someone/abc123/raw/f00/model.idf',
    );
  });

  it('resolves relative addresses against the viewer and rejects what is not http(s)', () => {
    expect(downloadUrl('examples/1ZoneUncontrolled.idf', BASE)).toBe(
      `${BASE}examples/1ZoneUncontrolled.idf`,
    );
    expect(() => downloadUrl('ftp://example.org/a.idf', BASE)).toThrow('https://');
    expect(() => downloadUrl('file:///Users/me/a.idf', BASE)).toThrow('https://');
    expect(() => downloadUrl('https://', BASE)).toThrow('not a web address');
  });

  it('names the file after the last part of its address', () => {
    expect(fileNameOf(RAW)).toBe('1ZoneUncontrolled.idf');
    expect(fileNameOf('https://example.org/dir/My%20model.idf?rev=2')).toBe('My model.idf');
    expect(fileNameOf('https://gist.githubusercontent.com/someone/abc123/raw')).toBe(
      'gist.githubusercontent.com',
    );
    expect(displayName('https://github.com/o/r/blob/main/a.idf', BASE)).toBe('a.idf');
    expect(displayName('ftp://x', BASE)).toBe('ftp://x');
  });
});

describe('downloading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const serve = (response: Response | Error) => {
    const fetch = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('downloads the raw file of a GitHub page', async () => {
    const fetch = serve(new Response('Version,26.2;\n'));
    const source = await downloadIdf(
      'https://github.com/NREL/EnergyPlus/blob/develop/testfiles/1ZoneUncontrolled.idf',
      BASE,
    );
    expect(fetch).toHaveBeenCalledWith(RAW);
    expect(source.name).toBe('1ZoneUncontrolled.idf');
    expect(new TextDecoder().decode(source.buffer)).toBe('Version,26.2;\n');
  });

  it('explains what went wrong', async () => {
    serve(new Response('', { status: 404 }));
    await expect(downloadIdf(RAW, BASE)).rejects.toThrow('the server answered 404 (not found)');
    serve(new TypeError('Failed to fetch'));
    await expect(downloadIdf(RAW, BASE)).rejects.toThrow('CORS');
    serve(new Response('﻿  <!DOCTYPE html><html></html>'));
    await expect(downloadIdf(RAW, BASE)).rejects.toThrow('web page');
    const fetch = serve(new Response('Version,26.2;'));
    await expect(downloadIdf('http://example.org/a.idf', BASE)).rejects.toThrow('https://');
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      downloadIdf('http://localhost:5173/a.idf', 'http://localhost:5173/'),
    ).resolves.toBeDefined();
  });
});
