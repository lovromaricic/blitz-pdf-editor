import { describe, expect, it } from 'vitest';
import { formatBytes, hasPdfHeader, readPdfFiles } from '../src/lib/files';

const enc = (s: string) => new TextEncoder().encode(s);

describe('hasPdfHeader', () => {
  it('accepts a standard header', () => {
    expect(hasPdfHeader(enc('%PDF-1.7\n...'))).toBe(true);
  });
  it('accepts a header after leading junk within 1 KB', () => {
    expect(hasPdfHeader(enc('﻿junk%PDF-1.4'))).toBe(true);
  });
  it('rejects a header beyond 1 KB', () => {
    expect(hasPdfHeader(enc('x'.repeat(1100) + '%PDF-1.4'))).toBe(false);
  });
  it('rejects non-PDF content', () => {
    expect(hasPdfHeader(enc('\x89PNG\r\n'))).toBe(false);
    expect(hasPdfHeader(new Uint8Array())).toBe(false);
  });
});

describe('readPdfFiles', () => {
  it('splits accepted and rejected files', async () => {
    const result = await readPdfFiles([
      new File([enc('%PDF-1.7 body')], 'a.pdf'),
      new File([enc('hello')], 'notes.txt'),
      new File([], 'empty.pdf'),
    ]);
    expect(result.accepted.map((f) => f.name)).toEqual(['a.pdf']);
    expect(result.rejected).toEqual([
      { name: 'notes.txt', reason: 'This is not a PDF file.' },
      { name: 'empty.pdf', reason: 'The file is empty.' },
    ]);
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
