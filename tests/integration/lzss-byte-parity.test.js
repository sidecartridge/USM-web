import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lzssCompress, lzssDecompress } from '../../src/lzss.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');

function readBytes(path) {
  return new Uint8Array(readFileSync(path));
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

function describeDiff(actual, expected) {
  const off = firstDiff(actual, expected);
  if (off === -1) return null;
  const win = 16;
  const start = Math.max(0, off - win / 2);
  const end = Math.min(Math.max(actual.length, expected.length), off + win);
  const slice = (buf) =>
    Array.from(buf.slice(start, end))
      .map((b, i) => (start + i === off ? `[${b.toString(16).padStart(2, '0')}]` : b.toString(16).padStart(2, '0')))
      .join(' ');
  return `first diff at offset ${off}\n  actual:   ${slice(actual)}\n  expected: ${slice(expected)}\n  lengths:  actual=${actual.length}, expected=${expected.length}`;
}

const FIXTURES_TO_DIFF = [
  { name: 'hello.prg',     in: 'hello.prg',     out: 'lzss/hello.lz' },
  { name: 'synthetic.bin', in: 'synthetic.bin', out: 'lzss/synthetic.lz' },
];

describe('lzssCompress byte-parity vs C reference', () => {
  for (const f of FIXTURES_TO_DIFF) {
    it(`matches the C harness output for ${f.name}`, () => {
      const input = readBytes(join(FIXTURES, f.in));
      const expected = readBytes(join(FIXTURES, f.out));
      const actual = lzssCompress(input);
      const diff = describeDiff(actual, expected);
      if (diff) throw new Error(diff);
      expect(actual.length).toBe(expected.length);
    });

    it(`round-trips ${f.name} losslessly`, () => {
      const input = readBytes(join(FIXTURES, f.in));
      const compressed = lzssCompress(input);
      const decoded = lzssDecompress(compressed, input.length);
      expect(decoded).toEqual(input);
    });
  }
});
