import { describe, it, expect } from 'vitest';
import { buildCart } from '../../src/cart-writer.js';

// Minimal "valid PRG" bytes for inputs that aren't supposed to reach
// the parsing layer, the conflict checks fire first.
function dummyPrg() {
  const buf = new Uint8Array(28 + 16);
  const v = new DataView(buf.buffer);
  v.setUint16(0, 0x601A, false);
  v.setUint32(2, 16, false);
  v.setUint16(26, 1, false); // absflag = 1 -> no fixups needed
  return buf;
}

const MTIME = new Date('2024-01-15T13:45:30Z');

describe('buildCart conflict rules', () => {
  it('rejects -z combined with -c (classic)', () => {
    expect(() => buildCart({
      programs: [{ name: 'a.prg', bytes: dummyPrg(), compress: true, initFlagDigit: null, mtime: MTIME }],
      classic: true,
    })).toThrow(/-z and -c are incompatible/);
  });

  it('rejects -z combined with -d (diagnostic, without -c)', () => {
    // Matching the C tool's check order: -z+-c fires before -z+-d, and
    // -z+-d fires before -d-requires-c. So we hit -z+-d in isolation by
    // setting compress + diagnostic with classic = false.
    expect(() => buildCart({
      programs: [{ name: 'a.prg', bytes: dummyPrg(), compress: true, initFlagDigit: null, mtime: MTIME }],
      diagnostic: true,
    })).toThrow(/-z and -d are incompatible/);
  });

  it('reports -z+-c first when -z, -c, and -d are all set', () => {
    expect(() => buildCart({
      programs: [{ name: 'a.prg', bytes: dummyPrg(), compress: true, initFlagDigit: null, mtime: MTIME }],
      classic: true,
      diagnostic: true,
    })).toThrow(/-z and -c are incompatible/);
  });

  it('rejects -d without -c', () => {
    expect(() => buildCart({
      programs: [{ name: 'a.prg', bytes: dummyPrg(), compress: false, initFlagDigit: null, mtime: MTIME }],
      diagnostic: true,
    })).toThrow(/-d \(diagnostic\) requires -c \(classic mode\)/);
  });

  it('rejects diagnostic carts with more than one program', () => {
    expect(() => buildCart({
      programs: [
        { name: 'a.prg', bytes: dummyPrg(), compress: false, initFlagDigit: null, mtime: MTIME },
        { name: 'b.prg', bytes: dummyPrg(), compress: false, initFlagDigit: null, mtime: MTIME },
      ],
      classic: true,
      diagnostic: true,
    })).toThrow(/diagnostic carts must contain exactly one program/);
  });

  it('rejects empty programs list', () => {
    expect(() => buildCart({ programs: [] }))
      .toThrow(/non-empty array/);
  });
});
