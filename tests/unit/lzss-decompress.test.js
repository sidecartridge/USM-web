import { describe, it, expect } from 'vitest';
import { lzssCompress, lzssDecompress, LZSS_MAX_MATCH, LZSS_WIN_SIZE } from '../../src/lzss.js';

describe('lzssDecompress — structural smoke', () => {
  it('decodes a single literal byte', () => {
    const out = lzssDecompress(new Uint8Array([0x00, 0x42]), 1);
    expect(Array.from(out)).toEqual([0x42]);
  });

  it('decodes AAAA from literal + back-reference', () => {
    // Matches the encoding asserted in lzss-compress.test.js.
    const out = lzssDecompress(new Uint8Array([0x40, 0x41, 0x00, 0x00]), 4);
    expect(Array.from(out)).toEqual([0x41, 0x41, 0x41, 0x41]);
  });

  it('honours the overlapping-source RLE semantics', () => {
    // off=1 len=4: 'A' then "back-ref off=1 len=4" must produce 'AAAA'
    // by reading bytes that are written in the same loop.
    // Manual encoding: flag = 0x40 (bit 6 = back-ref).
    //   literal 'A' (0x41)
    //   back-ref (off=1, len=4): encOff=0, encLen=1, word=0x0001
    // Total 4 bytes -> 5 output bytes.
    const out = lzssDecompress(new Uint8Array([0x40, 0x41, 0x00, 0x01]), 5);
    expect(Array.from(out)).toEqual([0x41, 0x41, 0x41, 0x41, 0x41]);
  });
});

describe('lzssDecompress — error paths', () => {
  it('throws when source is exhausted mid-flag', () => {
    expect(() => lzssDecompress(new Uint8Array([]), 1))
      .toThrow(/source exhausted/);
  });

  it('throws on a back-reference before the start of output', () => {
    // Flag 0x80 = first token is a back-ref; word = 0x0000 means
    // off = 1, len = 3. At out=0, off > out, so this is invalid.
    expect(() => lzssDecompress(new Uint8Array([0x80, 0x00, 0x00]), 3))
      .toThrow(/back-reference before start of output/);
  });

  it('throws when a back-reference overruns expectedSize', () => {
    // Literal 'A', then back-ref len=3 -> 4 bytes total, but we ask
    // for only 3.
    expect(() => lzssDecompress(new Uint8Array([0x40, 0x41, 0x00, 0x00]), 3))
      .toThrow(/overruns expected size/);
  });

  it('throws on a truncated back-reference', () => {
    // Flag says "back-ref" but only 1 byte of the 2-byte word remains.
    expect(() => lzssDecompress(new Uint8Array([0x80, 0x00]), 3))
      .toThrow(/truncated back-reference/);
  });
});

describe('lzss round-trip', () => {
  function roundtrip(bytes) {
    return lzssDecompress(lzssCompress(bytes), bytes.length);
  }

  it('round-trips a single byte', () => {
    const src = new Uint8Array([0x42]);
    expect(Array.from(roundtrip(src))).toEqual([0x42]);
  });

  it('round-trips all-zero buffers of varied lengths', () => {
    for (const n of [1, 16, 17, 18, 19, 100, 1024, LZSS_WIN_SIZE * 2 + 7]) {
      const src = new Uint8Array(n);
      expect(roundtrip(src)).toEqual(src);
    }
  });

  it('round-trips a byte-counter pattern', () => {
    const src = new Uint8Array(LZSS_WIN_SIZE * 2);
    for (let i = 0; i < src.length; i++) src[i] = i & 0xff;
    expect(roundtrip(src)).toEqual(src);
  });

  it('round-trips a deterministic PRNG stress buffer', () => {
    // 64 KB of LCG output. The encoder gets a buffer that mixes random
    // bytes with occasional repeats, exercising both code paths.
    const src = new Uint8Array(64 * 1024);
    let s = 0x12345678 | 0;
    for (let i = 0; i < src.length; i++) {
      s = (Math.imul(s, 1103515245) + 12345) | 0;
      src[i] = (s >>> 16) & 0xff;
    }
    expect(roundtrip(src)).toEqual(src);
  });

  it('round-trips the LZSS_MAX_MATCH cap edge case', () => {
    const src = new Uint8Array(LZSS_MAX_MATCH * 8);
    expect(roundtrip(src)).toEqual(src);
  });
});
