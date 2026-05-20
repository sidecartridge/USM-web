import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCart } from '../../src/cart-writer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const GOLDEN = join(HERE, '..', 'golden');
const PIN = JSON.parse(readFileSync(join(HERE, '..', 'goldens.upstream.json'), 'utf8'));
const MTIME = new Date(PIN.fixedMtime);

function bytes(path) {
  return new Uint8Array(readFileSync(path));
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function describeDiff(actual, expected) {
  const off = firstDiff(actual, expected);
  if (off === -1) return null;
  const win = 32;
  const start = Math.max(0, off - win / 2);
  const end = Math.min(Math.max(actual.length, expected.length), off + win);
  const hex = (b) =>
    Array.from(b.slice(start, end))
      .map((v, i) => (start + i === off ? `[${v.toString(16).padStart(2, '0')}]` : v.toString(16).padStart(2, '0')))
      .join(' ');
  return `first diff at 0x${off.toString(16)} (${off})\n  actual:   ${hex(actual)}\n  expected: ${hex(expected)}\n  lengths:  actual=${actual.length}, expected=${expected.length}`;
}

function expectByteIdentical(actual, expected) {
  const diff = describeDiff(actual, expected);
  if (diff) throw new Error(diff);
  expect(actual.length).toBe(expected.length);
}

const hello = bytes(join(FIXTURES, 'hello.prg'));
const synth = bytes(join(FIXTURES, 'synth.prg'));
const reloc = bytes(join(FIXTURES, 'reloc.prg'));

function p(opts) {
  return { compress: false, initFlagDigit: null, mtime: MTIME, ...opts };
}

describe('buildCart byte-parity vs C reference', () => {
  it('hello-default (single program, default mode)', () => {
    const cart = buildCart({
      programs: [p({ name: 'hello.prg', bytes: hello })],
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'hello-default.ROM')));
  });

  it('hello-f3 (single program, -f3 auto-launch)', () => {
    const cart = buildCart({
      programs: [p({ name: 'hello.prg', bytes: hello, initFlagDigit: 3 })],
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'hello-f3.ROM')));
  });

  it('hello-steem (single program, -s STEem prefix)', () => {
    const cart = buildCart({
      programs: [p({ name: 'hello.prg', bytes: hello })],
      steem: true,
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'hello-steem.STC')));
  });

  it('hello-z-fallback (-z requested, auto-falls-back for tiny PRG)', () => {
    const cart = buildCart({
      programs: [p({ name: 'hello.prg', bytes: hello, compress: true })],
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'hello-z-fallback.ROM')));
  });

  it('synth-z (-z that actually compresses)', () => {
    const cart = buildCart({
      programs: [p({ name: 'synth.prg', bytes: synth, compress: true })],
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'synth-z.ROM')));
  });

  it('multi-default (three copies of hello.prg, CA_NEXT chain)', () => {
    const cart = buildCart({
      programs: [
        p({ name: 'hello.prg', bytes: hello }),
        p({ name: 'hello.prg', bytes: hello }),
        p({ name: 'hello.prg', bytes: hello }),
      ],
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'multi-default.ROM')));
  });

  it('multi-mixed (default + compressed + default, per-program -z)', () => {
    const cart = buildCart({
      programs: [
        p({ name: 'hello.prg', bytes: hello }),
        p({ name: 'synth.prg', bytes: synth, compress: true }),
        p({ name: 'hello.prg', bytes: hello }),
      ],
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'multi-mixed.ROM')));
  });

  it('reloc-classic (-c with two fixups, default BSS at 0x20000)', () => {
    const cart = buildCart({
      programs: [p({ name: 'reloc.prg', bytes: reloc })],
      classic: true,
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'reloc-classic.ROM')));
  });

  it('reloc-classic-b40000 (-c -b40000, custom BSS base)', () => {
    const cart = buildCart({
      programs: [p({ name: 'reloc.prg', bytes: reloc })],
      classic: true,
      globalBssAddr: 0x40000,
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'reloc-classic-b40000.ROM')));
  });

  it('reloc-diag (-d -c, diagnostic + classic + relocations)', () => {
    const cart = buildCart({
      programs: [p({ name: 'reloc.prg', bytes: reloc })],
      classic: true,
      diagnostic: true,
    });
    expectByteIdentical(cart, bytes(join(GOLDEN, 'reloc-diag.ROM')));
  });
});
