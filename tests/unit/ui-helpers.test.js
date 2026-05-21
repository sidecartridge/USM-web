import { describe, it, expect } from 'vitest';
import { defaultOutputName, formatLogLine, parseHexAddress, formatSize } from '../../src/ui.js';

describe('defaultOutputName', () => {
  it('keeps the stem and replaces the extension', () => {
    expect(defaultOutputName('hello.prg', 'rom')).toBe('HELLO.ROM');
    expect(defaultOutputName('SWITV310.TOS', 'rom')).toBe('SWITV310.ROM');
  });

  it('picks .STC for STEem output', () => {
    expect(defaultOutputName('hello.prg', 'stc')).toBe('HELLO.STC');
  });

  it('picks .ROM for diagnostic output', () => {
    expect(defaultOutputName('hello.prg', 'diag')).toBe('HELLO.ROM');
  });

  it('handles names with no extension', () => {
    expect(defaultOutputName('hello', 'rom')).toBe('HELLO.ROM');
  });

  it('falls back to CART.ROM when no program name is supplied', () => {
    expect(defaultOutputName('', 'rom')).toBe('CART.ROM');
    expect(defaultOutputName(null, 'rom')).toBe('CART.ROM');
    expect(defaultOutputName(undefined, 'rom')).toBe('CART.ROM');
  });
});

describe('formatLogLine', () => {
  it('formats a program-start event', () => {
    const out = formatLogLine({ type: 'program-start', name: 'hello.prg', index: 1, total: 3 });
    expect(out).toBe('==> [1/3] hello.prg');
  });

  it('formats a PRG header event with hex prgflags', () => {
    const out = formatLogLine({
      type: 'header',
      name: 'hello.prg',
      tsize: 42, dsize: 0, bsize: 0, ssize: 14, prgflags: 0x0E, absflag: 0,
    });
    expect(out).toBe('      PRG header: tsize=42 dsize=0 bsize=0 ssize=14 prgflags=0xe absflag=0');
  });

  it('formats a default-mode layout event with CA_HEADER and payload addresses', () => {
    const out = formatLogLine({
      type: 'layout',
      name: 'hello.prg',
      mode: 'default',
      diagnostic: false,
      caHeaderAddr: 0xFA0004,
      payloadAddr: 0xFA0026,
      payloadSize: 324,
      paddedSize: 324 + 34,
    });
    expect(out).toBe('      Layout: default mode, stub + PRG — CA_HEADER at $FA0004, payload at $FA0026 (324 bytes)');
  });

  it('formats a classic-mode layout event', () => {
    const out = formatLogLine({
      type: 'layout',
      name: 'reloc.prg',
      mode: 'classic',
      diagnostic: false,
      caHeaderAddr: 0xFA0004,
      payloadAddr: 0xFA0026,
      payloadSize: 16,
      paddedSize: 50,
    });
    expect(out).toContain('classic mode, TEXT+DATA');
    expect(out).toContain('payload at $FA0026 (16 bytes)');
  });

  it('formats a diagnostic-mode layout event (no CA_HEADER)', () => {
    const out = formatLogLine({
      type: 'layout',
      name: 'reloc.prg',
      mode: 'classic',
      diagnostic: true,
      caHeaderAddr: null,
      payloadAddr: 0xFA0004,
      payloadSize: 16,
      paddedSize: 16,
    });
    expect(out).toBe('      Layout: diagnostic mode, TEXT+DATA at $FA0004 (16 bytes, no CA_HEADER)');
  });

  it('formats a fixups event with BSS address', () => {
    const out = formatLogLine({ type: 'fixups', name: 'reloc.prg', count: 2, bssAddr: 0x20000 });
    expect(out).toBe('      Relocations: 2 fixups applied (BSS base $020000)');
  });

  it('formats a zero-fixups event distinctly', () => {
    const out = formatLogLine({ type: 'fixups', name: 'hello.prg', count: 0, bssAddr: 0x20000 });
    expect(out).toMatch(/Relocations: none/);
  });

  it('formats a compressed event with one decimal place', () => {
    const out = formatLogLine({
      type: 'compressed',
      name: 'SWITV310.TOS',
      origSize: 57436,
      compSize: 41696,
      dataRatio: 72.591,
    });
    expect(out).toBe('      + SWITV310.TOS: compressed 57436 -> 41696 (72.6%)');
  });

  it('formats a fallback event with zero decimal places', () => {
    const out = formatLogLine({
      type: 'fallback',
      name: 'hello.prg',
      entryRatio: 119.4,
    });
    expect(out).toBe('      + hello.prg: no savings (119% entry), shipping uncompressed');
  });

  it('formats a summary event', () => {
    const out = formatLogLine({
      type: 'summary',
      totalBytes: 131072,
      programCount: 1,
      usmFillBytes: 130614,
      steem: false,
    });
    expect(out).toBe('==> Cart ready: 131072 bytes, 1 program, 130614 bytes USM!-fill remaining');
  });

  it('formats a summary event with STEem suffix', () => {
    const out = formatLogLine({
      type: 'summary',
      totalBytes: 131076,
      programCount: 3,
      usmFillBytes: 90000,
      steem: true,
    });
    expect(out).toBe('==> Cart ready: 131076 bytes, 3 programs, 90000 bytes USM!-fill remaining (.STC: 4-byte prefix + 128 KB cart)');
  });
});

describe('parseHexAddress', () => {
  it.each([
    ['20000', 0x20000],
    ['40000', 0x40000],
    ['fa0000', 0xFA0000],
    ['FFFFFFFF', 0xFFFFFFFF],
    ['0', 0],
  ])('parses %s as 0x%s', (input, expected) => {
    expect(parseHexAddress(input)).toBe(expected);
  });

  it.each(['', 'xyz', '0x20000', '12 34', '123456789', null, undefined])
    ('rejects invalid input %s', (input) => {
      expect(parseHexAddress(input)).toBeNull();
    });
});

describe('formatSize', () => {
  it('shows bytes below 1 KB', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(88)).toBe('88 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('shows KB with one decimal at and above 1 KB', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(131072)).toBe('128.0 KB');
  });
});
