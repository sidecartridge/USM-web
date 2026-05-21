import { describe, it, expect } from 'vitest';
import {
  writeClassicEntry,
  CA_HEADER_SIZE,
  CART_ROM_BASE,
} from '../../src/cart-writer.js';
import { PRG_HEADER_SIZE, PRG_MAGIC } from '../../src/prg.js';

const FIXED_MTIME = new Date('2024-01-15T13:45:30Z');

function buildPrg({ text, reloc, absflag = 0 }) {
  const buf = new Uint8Array(PRG_HEADER_SIZE + text.length + reloc.length);
  const v = new DataView(buf.buffer);
  v.setUint16(0, PRG_MAGIC, false);
  v.setUint32(2, text.length, false);
  v.setUint32(6, 0, false);
  v.setUint32(10, 0, false);
  v.setUint32(14, 0, false);
  v.setUint32(18, 0, false);
  v.setUint32(22, 0, false);
  v.setUint16(26, absflag, false);
  buf.set(text, PRG_HEADER_SIZE);
  buf.set(reloc, PRG_HEADER_SIZE + text.length);
  const header = { magic: PRG_MAGIC, tsize: text.length, dsize: 0, bsize: 0, ssize: 0, res1: 0, prgflags: 0, absflag };
  return { buf, header };
}

describe('writeClassicEntry, default classic mode (with CA_HEADER)', () => {
  it('lays out CA_HEADER + relocated TEXT', () => {
    const text = new Uint8Array(16);
    // 32-bit value at offset 4 = 8 (TEXT-internal pointer). The relocator
    // should rewrite it to CART_ROM_BASE + programOffsetInCart + 8.
    new DataView(text.buffer).setUint32(4, 8, false);
    const reloc = new Uint8Array([0, 0, 0, 4, 0]); // one fixup at offset 4
    const { buf: prg, header } = buildPrg({ text, reloc });

    const cartOffset = 4; // (just after the magic in a real cart)
    const cart = new Uint8Array(cartOffset + CA_HEADER_SIZE + 16 + 16).fill(0xCC);
    const view = new DataView(cart.buffer);

    const { bytesWritten: written } = writeClassicEntry(view, cartOffset, prg, header, {
      name: 'reloc.prg',
      initFlagDigit: null,
      mtime: FIXED_MTIME,
      nextEntryAddr: 0,
      bssAddr: 0x20000,
      diagnostic: false,
    });

    expect(written).toBe(CA_HEADER_SIZE + 16);

    // CA_RUN = CART_ROM_BASE + cartOffset + CA_HEADER_SIZE = 0xFA0026.
    expect(view.getUint32(cartOffset + 8, false)).toBe(0xFA0026);
    // CA_SIZE = program_size = 16 (already even).
    expect(view.getUint32(cartOffset + 16, false)).toBe(16);
    // CA_FILENAME[0..8] = "RELOC.PRG".
    expect(Array.from(cart.slice(cartOffset + 20, cartOffset + 29)))
      .toEqual([0x52, 0x45, 0x4C, 0x4F, 0x43, 0x2E, 0x50, 0x52, 0x47]);
    // TEXT[0..3] still all-zero (unfixed-up).
    const txtStart = cartOffset + CA_HEADER_SIZE;
    expect(Array.from(cart.slice(txtStart, txtStart + 4))).toEqual([0, 0, 0, 0]);
    // TEXT[4..7] rewritten to 0xFA0026 + 8 = 0xFA002E.
    expect(view.getUint32(txtStart + 4, false)).toBe(0xFA002E);
  });

  it('rounds odd-sized TEXT+DATA up to the next even byte', () => {
    // tsize = 15 (odd). program_size = (15+1) & ~1 = 16. The extra byte
    // copied from after TEXT in the PRG should be the first byte of the
    // reloc table (which is 0 in this minimal fixture).
    const text = new Uint8Array(15).fill(0x4E); // NOP-ish filler
    const reloc = new Uint8Array([0xAA, 0, 0, 0]); // first LONG = 0xAA000000 -> "no fixups"-ish
    //   ...actually setting first LONG = 0xAA000000 is a non-zero first
    // offset; we'd need the program_size to be at least 0xAA000000 + 4 to
    // be valid. We don't want that here, just want to test the round-up,
    // so make this a "no fixups" PRG via ABSFLAG=1 instead.
    const { buf: prg, header } = buildPrg({ text, reloc, absflag: 1 });

    const cartOffset = 4;
    const cart = new Uint8Array(cartOffset + CA_HEADER_SIZE + 16 + 4).fill(0xDD);
    const view = new DataView(cart.buffer);

    const { bytesWritten: written } = writeClassicEntry(view, cartOffset, prg, header, {
      name: 'odd.prg',
      initFlagDigit: null,
      mtime: FIXED_MTIME,
      nextEntryAddr: 0,
      bssAddr: 0x20000,
      diagnostic: false,
    });

    expect(written).toBe(CA_HEADER_SIZE + 16); // 16, not 15
    // CA_SIZE = 16
    expect(view.getUint32(cartOffset + 16, false)).toBe(16);
    // The extra (16th) byte should come from prg[PRG_HEADER_SIZE + 15] -
    // the first byte of the reloc table, which is 0xAA.
    expect(cart[cartOffset + CA_HEADER_SIZE + 15]).toBe(0xAA);
  });
});

describe('writeClassicEntry, diagnostic mode (no CA_HEADER)', () => {
  it('writes TEXT directly at offset, no header preamble', () => {
    const text = new Uint8Array(8);
    new DataView(text.buffer).setUint32(0, 0x4E714E71, false); // NOP NOP
    const reloc = new Uint8Array([0, 0, 0, 0]); // no fixups (alt encoding)
    const { buf: prg, header } = buildPrg({ text, reloc });

    const cartOffset = 4; // diagnostic carts: TEXT lives at $FA0004
    const cart = new Uint8Array(64).fill(0xEE);
    const view = new DataView(cart.buffer);

    const { bytesWritten: written } = writeClassicEntry(view, cartOffset, prg, header, {
      name: 'diag.prg',  // ignored in diagnostic
      initFlagDigit: null,
      mtime: FIXED_MTIME,
      nextEntryAddr: 0,
      bssAddr: 0x20000,
      diagnostic: true,
    });

    expect(written).toBe(8);
    // Bytes before the offset untouched.
    expect(cart.slice(0, cartOffset).every((b) => b === 0xEE)).toBe(true);
    // TEXT at the offset.
    expect(view.getUint32(cartOffset, false)).toBe(0x4E714E71);
    // Bytes after TEXT untouched (no CA_HEADER follows).
    expect(cart.slice(cartOffset + 8).every((b) => b === 0xEE)).toBe(true);
  });
});
