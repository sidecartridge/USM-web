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
