import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  tryCompress,
  writeCompressedEntry,
  CA_HEADER_SIZE,
  CART_ROM_BASE,
} from '../../src/cart-writer.js';
import { PRG_LOADER, PRG_LOADER_COMPRESSED } from '../../src/prg-loader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const HELLO_PRG = join(FIXTURES, 'hello.prg');
const SYNTHETIC = join(FIXTURES, 'synthetic.bin');

const FIXED_MTIME = new Date('2024-01-15T13:45:30Z');

describe('tryCompress', () => {
  it('falls back when compression does not help (tiny hello.prg)', () => {
    // hello.prg is 88 bytes. Compressed it's 77 bytes (per Story 4 manual
    // verification), but the 304-byte compressed stub vs the 236-byte
    // default stub adds 68 bytes of overhead. Net entry is bigger.
    const prg = new Uint8Array(readFileSync(HELLO_PRG));
    const result = tryCompress(prg);
    expect(result.kind).toBe('fallback');
    expect(result.entryRatio).toBeGreaterThan(100);
  });

  it('picks compressed when the entry footprint shrinks (synthetic fixture)', () => {
    // synthetic.bin is 1280 bytes. Compressed it's 719 bytes (Story 5
    // byte-parity reference). 304 + 4 + 719 = 1027 < 236 + 1280 = 1516.
    const data = new Uint8Array(readFileSync(SYNTHETIC));
    const result = tryCompress(data);
    expect(result.kind).toBe('compressed');
    expect(result.compressed.length).toBe(719);
    expect(result.dataRatio).toBeCloseTo((719 / 1280) * 100, 4);
  });
});

describe('writeCompressedEntry', () => {
  it('lays out CA_HEADER + compressed stub + size LONG + LZSS payload', () => {
    const data = new Uint8Array(readFileSync(SYNTHETIC));
    const { compressed } = tryCompress(data);

    const total = CA_HEADER_SIZE + PRG_LOADER_COMPRESSED.length + 4 + compressed.length;
    const buf = new Uint8Array(total + 16).fill(0xCC);
    const view = new DataView(buf.buffer);

    const written = writeCompressedEntry(view, 0, data, compressed, {
      name: 'synth.prg',
      initFlagDigit: null,
      mtime: FIXED_MTIME,
      nextEntryAddr: 0xFA0500,
    });

    expect(written).toBe(total);

    // CA_NEXT
    expect(Array.from(buf.slice(0, 4))).toEqual([0x00, 0xFA, 0x05, 0x00]);
    // CA_RUN = CART_ROM_BASE + 0 + CA_HEADER_SIZE = 0xFA0022
    expect(Array.from(buf.slice(8, 12))).toEqual([0x00, 0xFA, 0x00, 0x22]);
    // CA_SIZE = 304 + 4 + 719 = 1027 = 0x0403
    expect(Array.from(buf.slice(16, 20))).toEqual([0x00, 0x00, 0x04, 0x03]);

    // Compressed stub immediately after the header.
    expect(buf.slice(CA_HEADER_SIZE, CA_HEADER_SIZE + PRG_LOADER_COMPRESSED.length))
      .toEqual(PRG_LOADER_COMPRESSED);

    // 4-byte big-endian uncompressed-size LONG = 1280 = 0x500
    const sizeOff = CA_HEADER_SIZE + PRG_LOADER_COMPRESSED.length;
    expect(Array.from(buf.slice(sizeOff, sizeOff + 4))).toEqual([0x00, 0x00, 0x05, 0x00]);

    // Compressed payload immediately after the size LONG.
    expect(buf.slice(sizeOff + 4, sizeOff + 4 + compressed.length)).toEqual(compressed);

    // Tail cushion untouched.
    expect(buf.slice(total).every((b) => b === 0xCC)).toBe(true);
  });

  it('rejects non-Uint8Array inputs', () => {
    const buf = new Uint8Array(CA_HEADER_SIZE + PRG_LOADER_COMPRESSED.length + 4 + 100);
    const view = new DataView(buf.buffer);
    expect(() => writeCompressedEntry(view, 0, [1, 2, 3], new Uint8Array(10), {
      name: 'foo.prg', initFlagDigit: null, mtime: FIXED_MTIME, nextEntryAddr: 0,
    })).toThrow(/Uint8Array/);
  });
});
