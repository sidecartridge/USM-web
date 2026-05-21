import { describe, it, expect } from 'vitest';
import { lzssCompress, LZSS_MAX_MATCH, LZSS_WIN_SIZE } from '../../src/lzss.js';

describe('lzssCompress, structural smoke', () => {
  it('encodes a single literal byte', () => {
    // Single byte: flag = 0 (literal), then the byte itself. 2 bytes total.
    const out = lzssCompress(new Uint8Array([0x42]));
    expect(Array.from(out)).toEqual([0x00, 0x42]);
  });

  it('encodes a 4-byte AAAA run as literal + back-reference', () => {
    // bit 0: 'A' literal at offset 0.
    // bit 1: 3-byte run "AAA" matches at offset 1, length 3.
    //        encOff = 0, encLen = 0  =>  word = 0x0000 (two bytes).
    // Flag has bit 6 (the second token, MSB-first) set => 0x40.
    const out = lzssCompress(new Uint8Array([0x41, 0x41, 0x41, 0x41]));
    expect(Array.from(out)).toEqual([0x40, 0x41, 0x00, 0x00]);
  });

  it('does not emit back-references for inputs shorter than MIN_MATCH', () => {
    // Two bytes < MIN_MATCH (3): both must ship as literals.
    const out = lzssCompress(new Uint8Array([0x41, 0x41]));
    expect(Array.from(out)).toEqual([0x00, 0x41, 0x41]);
  });

  it('produces compact output for long all-zero input (worst-case beat)', () => {
    // 1024 zeros should compress to far fewer bytes than the input.
    const out = lzssCompress(new Uint8Array(1024));
    expect(out.length).toBeLessThan(150);
  });

  it('caps match length at LZSS_MAX_MATCH', () => {
    // 144 zeros = LZSS_MAX_MATCH * 8. The first byte has no prior context
    // so it ships as a literal; that consumes a token in the first flag
    // block, leaving room for 7 max-length back-references (covering 126
    // more bytes, total 127 consumed). The 17 remaining bytes form one
    // back-ref of length 17 in a second flag block. Sizes:
    //   block 1: 1 flag + 1 literal + 7 * 2-byte back-refs  = 16 bytes
    //   block 2: 1 flag + 1 * 2-byte back-ref               =  3 bytes
    const out = lzssCompress(new Uint8Array(LZSS_MAX_MATCH * 8));
    expect(out.length).toBe(19);
  });

  it('handles inputs longer than the sliding window', () => {
    // First WIN_SIZE bytes are literals (no prior context). Then the
    // next WIN_SIZE bytes are identical to the first and should all be
    // encoded as back-references. The exact compressed length depends
    // on the encoder's match-search, but the output must be much
    // smaller than 2 * WIN_SIZE.
    const half = new Uint8Array(LZSS_WIN_SIZE);
    for (let i = 0; i < half.length; i++) half[i] = i & 0xff;
    const full = new Uint8Array(LZSS_WIN_SIZE * 2);
    full.set(half, 0);
    full.set(half, LZSS_WIN_SIZE);
    const out = lzssCompress(full);
    expect(out.length).toBeLessThan(full.length);
  });
});
