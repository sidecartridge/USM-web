import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrgHeader, PRG_HEADER_SIZE, PRG_MAGIC, PRG_MAX_FILE_SIZE } from '../../src/prg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELLO_PRG = join(HERE, '..', 'fixtures', 'hello.prg');

function bytes(...values) {
  return new Uint8Array(values);
}

function minimalPrg(overrides = {}) {
  const buf = new Uint8Array(PRG_HEADER_SIZE);
  const v = new DataView(buf.buffer);
  v.setUint16(0, PRG_MAGIC, false);
  v.setUint32(2,  overrides.tsize    ?? 0,  false);
  v.setUint32(6,  overrides.dsize    ?? 0,  false);
  v.setUint32(10, overrides.bsize    ?? 0,  false);
  v.setUint32(14, overrides.ssize    ?? 0,  false);
  v.setUint32(18, overrides.res1     ?? 0,  false);
  v.setUint32(22, overrides.prgflags ?? 0,  false);
  v.setUint16(26, overrides.absflag  ?? 0,  false);
  return buf;
}

describe('parsePrgHeader', () => {
  it('parses the hello.prg fixture', () => {
    const bytes = new Uint8Array(readFileSync(HELLO_PRG));
    const h = parsePrgHeader(bytes);
    // From `xxd -l 28 hello.prg`:
    //   60 1a 00 00 00 2a 00 00 00 00 00 00 00 00 00 00
    //   00 0e 00 00 00 00 00 00 00 00 00 00
    // -> tsize=0x2A (42 bytes), ssize=0x0E (14 bytes symbol table),
    //    everything else zero.
    expect(h.magic).toBe(PRG_MAGIC);
    expect(h.tsize).toBe(0x2A);
    expect(h.dsize).toBe(0);
    expect(h.bsize).toBe(0);
    expect(h.ssize).toBe(0x0E);
    expect(h.res1).toBe(0);
    expect(h.prgflags).toBe(0);
    expect(h.absflag).toBe(0);
  });

  it('parses a hand-crafted minimal PRG header', () => {
    const buf = minimalPrg({ tsize: 0x100, dsize: 0x50, bsize: 0x200, ssize: 0x10, prgflags: 7, absflag: 1 });
    const h = parsePrgHeader(buf);
    expect(h.tsize).toBe(0x100);
    expect(h.dsize).toBe(0x50);
    expect(h.bsize).toBe(0x200);
    expect(h.ssize).toBe(0x10);
    expect(h.prgflags).toBe(7);
    expect(h.absflag).toBe(1);
  });

  it('rejects a buffer shorter than PRG_HEADER_SIZE', () => {
    expect(() => parsePrgHeader(new Uint8Array(PRG_HEADER_SIZE - 1)))
      .toThrow(/at least 28/);
  });

  it('rejects a non-PRG magic', () => {
    const buf = minimalPrg();
    buf[0] = 0xFF;
    buf[1] = 0xFF;
    expect(() => parsePrgHeader(buf)).toThrow(/bad magic 0xffff/);
  });

  it('rejects a file larger than 128 KB', () => {
    const buf = new Uint8Array(PRG_MAX_FILE_SIZE + 1);
    new DataView(buf.buffer).setUint16(0, PRG_MAGIC, false);
    expect(() => parsePrgHeader(buf)).toThrow(/exceeds the 128 KB cart limit/);
  });

  it('rejects non-Uint8Array inputs', () => {
    expect(() => parsePrgHeader(bytes(0x60, 0x1A).buffer))
      .toThrow(/expected a Uint8Array/);
  });
});
