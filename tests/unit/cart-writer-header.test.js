import { describe, it, expect } from 'vitest';
import {
  writeCaHeader,
  encodeInitFlag,
  CA_HEADER_SIZE,
  CART_ROM_BASE,
} from '../../src/cart-writer.js';
import { toEightThreeName } from '../../src/gemdos.js';

describe('encodeInitFlag', () => {
  // Matches the `1 << (24 + Y)` encoding in usm.c:144.
  it.each([
    [0, 0x01000000],
    [1, 0x02000000],
    [3, 0x08000000],
    [5, 0x20000000],
    [6, 0x40000000],
    [7, 0x80000000],
  ])('encodes -f%d as 0x%s', (flag, expected) => {
    expect(encodeInitFlag(flag)).toBe(expected);
  });

  it.each([2, 4, 8, -1])('rejects unsupported flag %d', (flag) => {
    expect(() => encodeInitFlag(flag)).toThrow(/0, 1, 3, 5, 6, or 7/);
  });
});

describe('writeCaHeader', () => {
  it('lays out all seven fields in big-endian at the right offsets', () => {
    const buf = new Uint8Array(CA_HEADER_SIZE);
    const filename = toEightThreeName('foo.prg');
    writeCaHeader(new DataView(buf.buffer), 0, {
      next: 0xFA001000,
      init: 0x08FA0022,
      run:  0xFA000022,
      time: 0x1234,
      date: 0x5678,
      size: 0x0000ABCD,
      filename,
    });
    // CA_NEXT (4)
    expect(Array.from(buf.slice(0, 4))).toEqual([0xFA, 0x00, 0x10, 0x00]);
    // CA_INIT (4)
    expect(Array.from(buf.slice(4, 8))).toEqual([0x08, 0xFA, 0x00, 0x22]);
    // CA_RUN (4)
    expect(Array.from(buf.slice(8, 12))).toEqual([0xFA, 0x00, 0x00, 0x22]);
    // CA_TIME (2)
    expect(Array.from(buf.slice(12, 14))).toEqual([0x12, 0x34]);
    // CA_DATE (2)
    expect(Array.from(buf.slice(14, 16))).toEqual([0x56, 0x78]);
    // CA_SIZE (4)
    expect(Array.from(buf.slice(16, 20))).toEqual([0x00, 0x00, 0xAB, 0xCD]);
    // CA_FILENAME (14): "FOO.PRG" then NULs.
    expect(Array.from(buf.slice(20, 34))).toEqual([
      0x46, 0x4F, 0x4F, 0x2E, 0x50, 0x52, 0x47,
      0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('writes at a non-zero offset without spill', () => {
    const buf = new Uint8Array(CA_HEADER_SIZE * 2).fill(0xAA);
    writeCaHeader(new DataView(buf.buffer), CA_HEADER_SIZE, {
      next: 0, init: 0, run: 0, time: 0, date: 0, size: 0,
      filename: new Uint8Array(14),
    });
    // First record unmodified.
    expect(buf.slice(0, CA_HEADER_SIZE).every((b) => b === 0xAA)).toBe(true);
    // Second record zeroed.
    expect(buf.slice(CA_HEADER_SIZE).every((b) => b === 0)).toBe(true);
  });

  it('rejects filenames that are not 14-byte Uint8Arrays', () => {
    const buf = new Uint8Array(CA_HEADER_SIZE);
    expect(() => writeCaHeader(new DataView(buf.buffer), 0, {
      next: 0, init: 0, run: 0, time: 0, date: 0, size: 0,
      filename: new Uint8Array(13),
    })).toThrow(/14-byte Uint8Array/);
    expect(() => writeCaHeader(new DataView(buf.buffer), 0, {
      next: 0, init: 0, run: 0, time: 0, date: 0, size: 0,
      filename: 'HELLO',
    })).toThrow(/14-byte Uint8Array/);
  });
});

describe('CART_ROM_BASE', () => {
  it('is 0xFA0000', () => {
    expect(CART_ROM_BASE).toBe(0xFA0000);
  });
});
