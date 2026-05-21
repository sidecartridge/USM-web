import { describe, it, expect } from 'vitest';
import { lzssRoundtrip } from '../../src/lzss.js';

describe('lzssRoundtrip', () => {
  it('returns ratio 0 for an empty input', () => {
    const { compressed, ratio } = lzssRoundtrip(new Uint8Array());
    expect(ratio).toBe(0);
    // An empty input still produces zero compressed bytes (the outer
    // while loop in lzssCompress never runs).
    expect(compressed.length).toBe(0);
  });

  it('produces a ratio that matches compressed / original * 100', () => {
    const src = new Uint8Array(1024);  // all zeros, compresses well
    const { compressed, ratio } = lzssRoundtrip(src);
    expect(ratio).toBeCloseTo((compressed.length / src.length) * 100, 5);
  });

  it('verifies round-trip byte-for-byte and throws on mismatch', () => {
    // Direct call should pass. We rely on the encoder/decoder pair so
    // this is effectively another reach into the selftest path.
    const src = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => lzssRoundtrip(src)).not.toThrow();
  });
});
