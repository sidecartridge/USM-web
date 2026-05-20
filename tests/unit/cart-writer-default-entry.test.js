import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeDefaultEntry,
  CA_HEADER_SIZE,
  CART_ROM_BASE,
  encodeInitFlag,
} from '../../src/cart-writer.js';
import { PRG_LOADER } from '../../src/prg-loader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELLO_PRG = join(HERE, '..', 'fixtures', 'hello.prg');

const FIXED_MTIME = new Date('2024-01-15T13:45:30Z');

describe('writeDefaultEntry', () => {
  it('lays out CA_HEADER + stub + verbatim PRG bytes at offset 0', () => {
    const prg = new Uint8Array(readFileSync(HELLO_PRG));
    const buf = new Uint8Array(CA_HEADER_SIZE + PRG_LOADER.length + prg.length + 16).fill(0xAA);
    const view = new DataView(buf.buffer);

    const written = writeDefaultEntry(view, 0, prg, {
      name: 'hello.prg',
      initFlagDigit: null,
      mtime: FIXED_MTIME,
      nextEntryAddr: 0xFA1234,
    });

    expect(written).toBe(CA_HEADER_SIZE + PRG_LOADER.length + prg.length);

    // CA_HEADER: CA_NEXT = 0xFA1234
    expect(Array.from(buf.slice(0, 4))).toEqual([0x00, 0xFA, 0x12, 0x34]);
    // CA_INIT = 0 (initFlagDigit null)
    expect(Array.from(buf.slice(4, 8))).toEqual([0, 0, 0, 0]);
    // CA_RUN = CART_ROM_BASE + 0 + CA_HEADER_SIZE = 0xFA0022
    expect(Array.from(buf.slice(8, 12))).toEqual([0x00, 0xFA, 0x00, 0x22]);
    // CA_SIZE = stub + prg.length
    const expectedSize = PRG_LOADER.length + prg.length;
    expect(buf[16]).toBe((expectedSize >>> 24) & 0xff);
    expect(buf[17]).toBe((expectedSize >>> 16) & 0xff);
    expect(buf[18]).toBe((expectedSize >>> 8) & 0xff);
    expect(buf[19]).toBe(expectedSize & 0xff);
    // CA_FILENAME: "HELLO.PRG" then NULs.
    expect(Array.from(buf.slice(20, 34))).toEqual([
      0x48, 0x45, 0x4C, 0x4C, 0x4F, 0x2E, 0x50, 0x52, 0x47,
      0, 0, 0, 0, 0,
    ]);

    // Stub bytes immediately follow CA_HEADER.
    expect(buf.slice(CA_HEADER_SIZE, CA_HEADER_SIZE + PRG_LOADER.length))
      .toEqual(PRG_LOADER);

    // PRG bytes immediately follow the stub.
    expect(buf.slice(CA_HEADER_SIZE + PRG_LOADER.length, CA_HEADER_SIZE + PRG_LOADER.length + prg.length))
      .toEqual(prg);

    // Tail bytes (16-byte cushion) untouched.
    const tailStart = CA_HEADER_SIZE + PRG_LOADER.length + prg.length;
    expect(buf.slice(tailStart).every((b) => b === 0xAA)).toBe(true);
  });

  it('writes at a non-zero offset', () => {
    const prg = new Uint8Array(readFileSync(HELLO_PRG));
    const offset = 0x1000;
    const buf = new Uint8Array(offset + CA_HEADER_SIZE + PRG_LOADER.length + prg.length + 4).fill(0xBB);
    const view = new DataView(buf.buffer);

    writeDefaultEntry(view, offset, prg, {
      name: 'hello.prg',
      initFlagDigit: null,
      mtime: FIXED_MTIME,
      nextEntryAddr: 0,
    });

    // Bytes before the offset untouched.
    expect(buf.slice(0, offset).every((b) => b === 0xBB)).toBe(true);
    // CA_RUN at offset+8: 0xFA0000 + 0x1000 + 0x22 = 0xFA1022
    expect(Array.from(buf.slice(offset + 8, offset + 12))).toEqual([0x00, 0xFA, 0x10, 0x22]);
  });

  it('encodes the -f init flag into CA_INIT alongside the stub address', () => {
    const prg = new Uint8Array(readFileSync(HELLO_PRG));
    const buf = new Uint8Array(CA_HEADER_SIZE + PRG_LOADER.length + prg.length);
    const view = new DataView(buf.buffer);

    writeDefaultEntry(view, 0, prg, {
      name: 'hello.prg',
      initFlagDigit: 3, // 0x08000000
      mtime: FIXED_MTIME,
      nextEntryAddr: 0xFA1000,
    });

    // CA_INIT = 0x08FA0022 (init flag in top byte | stub addr in low 24)
    const expectedInit = (encodeInitFlag(3) + (CART_ROM_BASE + CA_HEADER_SIZE)) >>> 0;
    expect(Array.from(buf.slice(4, 8))).toEqual([
      (expectedInit >>> 24) & 0xff,
      (expectedInit >>> 16) & 0xff,
      (expectedInit >>> 8) & 0xff,
      expectedInit & 0xff,
    ]);
  });

  it('rejects a non-Uint8Array prgBytes input', () => {
    const buf = new Uint8Array(CA_HEADER_SIZE + PRG_LOADER.length + 16);
    const view = new DataView(buf.buffer);
    expect(() => writeDefaultEntry(view, 0, [1, 2, 3], {
      name: 'foo.prg',
      initFlagDigit: null,
      mtime: FIXED_MTIME,
      nextEntryAddr: 0,
    })).toThrow(/Uint8Array/);
  });
});
