import { describe, it, expect } from 'vitest';
import { relocateTextData } from '../../src/classic-mode.js';
import { CART_ROM_BASE } from '../../src/cart-writer.js';
import { PRG_HEADER_SIZE, PRG_MAGIC } from '../../src/prg.js';

// Helper: assemble a PRG file (header + text + reloc) and write its
// TEXT verbatim into a cart-style buffer at `offset`.
function setupCart({ text, reloc, programOffsetInCart, absflag = 0 }) {
  const prg = new Uint8Array(PRG_HEADER_SIZE + text.length + reloc.length);
  const pv = new DataView(prg.buffer);
  pv.setUint16(0, PRG_MAGIC, false);
  pv.setUint32(2, text.length, false);   // tsize
  pv.setUint32(6, 0, false);             // dsize
  pv.setUint32(10, 0, false);            // bsize
  pv.setUint32(14, 0, false);            // ssize
  pv.setUint32(18, 0, false);            // res1
  pv.setUint32(22, 0, false);            // prgflags
  pv.setUint16(26, absflag, false);
  prg.set(text, PRG_HEADER_SIZE);
  prg.set(reloc, PRG_HEADER_SIZE + text.length);

  const header = {
    magic: PRG_MAGIC,
    tsize: text.length, dsize: 0, bsize: 0, ssize: 0,
    res1: 0, prgflags: 0, absflag,
  };

  // Make a cart buffer big enough to hold the program at the chosen offset.
  const cart = new Uint8Array(programOffsetInCart + text.length + 32);
  cart.set(text, programOffsetInCart);
  return { prg, header, cart, view: new DataView(cart.buffer) };
}

function bytes(view, offset) {
  return [view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)];
}

describe('relocateTextData', () => {
  it('rewrites a TEXT fixup to CART_ROM_BASE + programOffset + originalValue', () => {
    // 16-byte TEXT with a 32-bit value at offset 4 pointing at offset 8
    // (within TEXT+DATA). After relocation that value should become
    // CART_ROM_BASE + programOffsetInCart + 8.
    const text = new Uint8Array(16);
    new DataView(text.buffer).setUint32(4, 0x08, false); // points at offset 8 (in TEXT)
    const reloc = new Uint8Array([0, 0, 0, 4, 0]); // one fixup at offset 4
    const programOffsetInCart = 0x100;
    const { prg, header, view } = setupCart({ text, reloc, programOffsetInCart });

    relocateTextData(view, programOffsetInCart, prg, header, /*bssAddr*/ 0x20000);

    const expected = (CART_ROM_BASE + programOffsetInCart + 8) >>> 0;
    expect(view.getUint32(programOffsetInCart + 4, false)).toBe(expected);
  });

  it('rewrites a BSS fixup to bssAddr + (original - program_size)', () => {
    // 16-byte TEXT. Value at offset 8 = 20 (>= program_size 16, so BSS).
    // After relocation: bssAddr + 20 - 16 = bssAddr + 4 = 0x20004.
    const text = new Uint8Array(16);
    new DataView(text.buffer).setUint32(8, 20, false);
    const reloc = new Uint8Array([0, 0, 0, 8, 0]);
    const programOffsetInCart = 0x100;
    const { prg, header, view } = setupCart({ text, reloc, programOffsetInCart });

    relocateTextData(view, programOffsetInCart, prg, header, /*bssAddr*/ 0x20000);

    expect(view.getUint32(programOffsetInCart + 8, false)).toBe(0x20004);
  });

  it('handles multiple fixups in one pass', () => {
    const text = new Uint8Array(20);
    const tv = new DataView(text.buffer);
    tv.setUint32(4, 12, false);     // TEXT-internal pointer to offset 12
    tv.setUint32(12, 0x100, false); // BSS pointer (0x100 > program_size 20)
    const reloc = new Uint8Array([0, 0, 0, 4, 8, 0]); // fixups at 4 and 12
    const programOffsetInCart = 0x40;
    const { prg, header, view } = setupCart({ text, reloc, programOffsetInCart });

    relocateTextData(view, programOffsetInCart, prg, header, /*bssAddr*/ 0x30000);

    expect(view.getUint32(programOffsetInCart + 4, false))
      .toBe((CART_ROM_BASE + programOffsetInCart + 12) >>> 0);
    expect(view.getUint32(programOffsetInCart + 12, false))
      .toBe((0x30000 + 0x100 - 20) >>> 0);
  });

  it('is a no-op when ABSFLAG is non-zero', () => {
    const text = new Uint8Array(16);
    const tv = new DataView(text.buffer);
    tv.setUint32(4, 0xDEADBEEF, false);
    // Even with a populated reloc stream, ABSFLAG = 1 short-circuits.
    const reloc = new Uint8Array([0, 0, 0, 4, 0]);
    const programOffsetInCart = 0x100;
    const { prg, header, view } = setupCart({ text, reloc, programOffsetInCart, absflag: 1 });

    relocateTextData(view, programOffsetInCart, prg, header, /*bssAddr*/ 0x20000);

    expect(view.getUint32(programOffsetInCart + 4, false)).toBe(0xDEADBEEF);
  });

  it('does nothing when the PRG has no fixups (first LONG = 0)', () => {
    const text = new Uint8Array(16);
    new DataView(text.buffer).setUint32(4, 0xCAFEBABE, false);
    const reloc = new Uint8Array([0, 0, 0, 0]); // alt-encoded "no fixups"
    const programOffsetInCart = 0x100;
    const { prg, header, view } = setupCart({ text, reloc, programOffsetInCart });

    relocateTextData(view, programOffsetInCart, prg, header, /*bssAddr*/ 0x20000);

    expect(view.getUint32(programOffsetInCart + 4, false)).toBe(0xCAFEBABE);
  });
});
