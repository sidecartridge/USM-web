// LZSS-12-4 codec — byte-faithful port of lzss_compress / lzss_decompress
// from atarist-USM/usm.c. The encoder makes the same greedy match decisions
// in the same order as the C reference, so its output is byte-identical.
//
// Bitstream: a sequence of <= 9-byte blocks. Each block is one flag byte
// followed by up to 8 tokens. Flag bits are MSB-first:
//   0 -> next 1 byte is a literal.
//   1 -> next 2 bytes are a back-reference, big-endian, packed as
//        ((offset - 1) << 4) | (length - 3). Offset 1..4096 (12 bits).
//        Length 3..18 (4 bits).
// No EOF marker — the decoder is driven by an explicit expected size
// (the cart writer stores it as a 4-byte big-endian LONG before the
// compressed payload).

export const LZSS_OFF_BITS = 12;
export const LZSS_LEN_BITS = 4;
export const LZSS_WIN_SIZE = 1 << LZSS_OFF_BITS;       // 4096
export const LZSS_MIN_MATCH = 3;
export const LZSS_MAX_MATCH = LZSS_MIN_MATCH + (1 << LZSS_LEN_BITS) - 1;  // 18

// Encodes `src` (Uint8Array) and returns a new Uint8Array of exactly the
// compressed length. Matches the greedy latest-first match scan in
// usm.c:198-256: at each position we walk window candidates from closest
// to furthest and keep the longest match (ties resolve to the closest
// occurrence). Identical scan order is what makes the output byte-equal
// to the C encoder.
export function lzssCompress(src) {
  const srclen = src.length;
  // Worst case: every input byte is a literal -> 9 output bytes per 8
  // input bytes. The +64 covers any tail-block flag byte plus a small
  // safety margin.
  const dst = new Uint8Array(srclen + Math.ceil(srclen / 8) + 64);

  let inp = 0;
  let out = 0;
  while (inp < srclen) {
    const flagPos = out++;
    let flag = 0;

    for (let bit = 0; bit < 8 && inp < srclen; bit++) {
      // Find the longest match in [windowStart, inp).
      const windowStart = inp > LZSS_WIN_SIZE ? inp - LZSS_WIN_SIZE : 0;
      let bestOff = 0;
      let bestLen = 0;
      let maxL = LZSS_MAX_MATCH;
      if (inp + maxL > srclen) maxL = srclen - inp;

      // Scan latest-first so a tie picks the closest occurrence.
      for (let j = inp; j > windowStart; ) {
        j--;
        let l = 0;
        while (l < maxL && src[j + l] === src[inp + l]) l++;
        if (l > bestLen) {
          bestLen = l;
          bestOff = inp - j;
          if (bestLen === LZSS_MAX_MATCH) break;
        }
      }

      if (bestLen >= LZSS_MIN_MATCH) {
        const encOff = bestOff - 1;
        const encLen = bestLen - LZSS_MIN_MATCH;
        const word = (encOff << LZSS_LEN_BITS) | encLen;
        dst[out++] = (word >>> 8) & 0xff;
        dst[out++] = word & 0xff;
        flag |= 1 << (7 - bit);
        inp += bestLen;
      } else {
        dst[out++] = src[inp++];
      }
    }

    dst[flagPos] = flag;
  }

  return dst.slice(0, out);
}

// Decodes `src` into a Uint8Array of exactly `expectedSize` bytes. The C
// reference returns -1 on any malformed input; we throw an Error so the
// caller (UI log pane) can surface a clear message. The cart writer stores
// the expected size as a 4-byte big-endian LONG before each compressed
// payload, so this is always known at decode time.
export function lzssDecompress(src, expectedSize) {
  const srclen = src.length;
  const dst = new Uint8Array(expectedSize);

  let inp = 0;
  let out = 0;
  while (out < expectedSize) {
    if (inp >= srclen) throw new Error('lzssDecompress: source exhausted');
    const flag = src[inp++];

    for (let bit = 0; bit < 8 && out < expectedSize; bit++) {
      if (flag & (1 << (7 - bit))) {
        if (inp + 2 > srclen) throw new Error('lzssDecompress: truncated back-reference');
        const word = (src[inp] << 8) | src[inp + 1];
        inp += 2;
        const off = (word >>> LZSS_LEN_BITS) + 1;
        const len = (word & ((1 << LZSS_LEN_BITS) - 1)) + LZSS_MIN_MATCH;
        if (off > out) throw new Error('lzssDecompress: back-reference before start of output');
        if (out + len > expectedSize) throw new Error('lzssDecompress: back-reference overruns expected size');
        // Byte-by-byte copy: source and destination ranges can overlap
        // (this is how LZSS encodes RLE-like runs).
        for (let k = 0; k < len; k++) {
          dst[out] = dst[out - off];
          out++;
        }
      } else {
        if (inp >= srclen) throw new Error('lzssDecompress: source exhausted at literal');
        dst[out++] = src[inp++];
      }
    }
  }
  return dst;
}

// Hand-rolled fixed buffer that exercises both literal and back-reference
// code paths. Mirrors the buffer in lzss_selftest() in atarist-USM/usm.c.
const SELFTEST_BUFFER = (() => {
  const s =
    'Hello, World! Hello, World! Hello, World!' +
    '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
})();

// Quick startup self-test. Runs once on module load (below) and is also
// exported so tests can call it explicitly. Throws on any failure so the
// module's top-level import in src/ui.js fails noisily — same behavior
// as the C tool which exits early at usm.c:363.
export function lzssSelftest() {
  const comp = lzssCompress(SELFTEST_BUFFER);
  const deco = lzssDecompress(comp, SELFTEST_BUFFER.length);
  if (deco.length !== SELFTEST_BUFFER.length) {
    throw new Error(`lzssSelftest: decoded length ${deco.length} != ${SELFTEST_BUFFER.length}`);
  }
  for (let i = 0; i < deco.length; i++) {
    if (deco[i] !== SELFTEST_BUFFER[i]) {
      throw new Error(`lzssSelftest: mismatch at offset ${i}: got 0x${deco[i].toString(16)}, expected 0x${SELFTEST_BUFFER[i].toString(16)}`);
    }
  }
}

// Run the self-test eagerly. If the encoder/decoder pair is broken,
// every consumer of this module sees the failure at import time.
lzssSelftest();

// Mirrors the hidden `usm -T <file>` debug command in usm.c:325-350:
// compress, decompress, byte-compare. Throws on round-trip mismatch
// (which would mean a real bug); on success, returns the compressed
// bytes and the ratio so the caller can format the same line the C
// tool prints.
export function lzssRoundtrip(input) {
  const compressed = lzssCompress(input);
  const decoded = lzssDecompress(compressed, input.length);
  for (let i = 0; i < input.length; i++) {
    if (decoded[i] !== input[i]) {
      throw new Error(`lzssRoundtrip: mismatch at offset ${i}`);
    }
  }
  const ratio = input.length === 0 ? 0 : (compressed.length / input.length) * 100;
  return { compressed, ratio };
}
