import { describe, it, expect } from 'vitest';
import { writeBE32, writeBE16 } from '../../src/cart-writer.js';

describe('writeBE32 / writeBE16', () => {
  it('writes a 32-bit value big-endian', () => {
    const buf = new Uint8Array(4);
    writeBE32(new DataView(buf.buffer), 0, 0xABCDEF42);
    expect(Array.from(buf)).toEqual([0xAB, 0xCD, 0xEF, 0x42]);
  });

  it('writes a 16-bit value big-endian', () => {
    const buf = new Uint8Array(2);
    writeBE16(new DataView(buf.buffer), 0, 0x601A);
    expect(Array.from(buf)).toEqual([0x60, 0x1A]);
  });

  it('writes at a non-zero offset without touching adjacent bytes', () => {
    const buf = new Uint8Array(8).fill(0xFF);
    writeBE32(new DataView(buf.buffer), 2, 0x12345678);
    expect(Array.from(buf)).toEqual([0xFF, 0xFF, 0x12, 0x34, 0x56, 0x78, 0xFF, 0xFF]);
  });

  it('truncates writeBE32 to 32 bits when given a larger value', () => {
    // Defensive: callers should never pass > 32 bits, but document the
    // behavior so the bug isn't silent. JS bit-ops coerce via | 0 / >>> 0
    // which makes 0x1_ABCDEF42 land as 0xABCDEF42.
    const buf = new Uint8Array(4);
    writeBE32(new DataView(buf.buffer), 0, 0x1ABCDEF42);
    expect(Array.from(buf)).toEqual([0xAB, 0xCD, 0xEF, 0x42]);
  });
});
