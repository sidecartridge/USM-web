import { describe, it, expect } from 'vitest';
import { walkRelocations, PRG_HEADER_SIZE, PRG_MAGIC } from '../../src/prg.js';

// Build a small valid-PRG buffer wrapping the given TEXT bytes and
// relocation stream. ssize is 0 for simplicity.
function buildPrg({ text, reloc, absflag = 0 }) {
  const buf = new Uint8Array(PRG_HEADER_SIZE + text.length + reloc.length);
  const v = new DataView(buf.buffer);
  v.setUint16(0, PRG_MAGIC, false);
  v.setUint32(2, text.length, false);
  v.setUint32(6, 0, false);   // dsize
  v.setUint32(10, 0, false);  // bsize
  v.setUint32(14, 0, false);  // ssize
  v.setUint32(18, 0, false);  // res1
  v.setUint32(22, 0, false);  // prgflags
  v.setUint16(26, absflag, false);
  buf.set(text, PRG_HEADER_SIZE);
  buf.set(reloc, PRG_HEADER_SIZE + text.length);
  return buf;
}

function parsed(text, reloc) {
  return {
    magic: PRG_MAGIC,
    tsize: text.length, dsize: 0, bsize: 0, ssize: 0,
    res1: 0, prgflags: 0, absflag: 0,
  };
}

describe('walkRelocations', () => {
  it('yields nothing when first LONG is 0 (no-fixups alt encoding)', () => {
    const text = new Uint8Array(16);
    const reloc = new Uint8Array([0, 0, 0, 0]); // first LONG = 0
    const prg = buildPrg({ text, reloc });
    const offsets = [];
    walkRelocations(prg, parsed(text, reloc), (o) => offsets.push(o));
    expect(offsets).toEqual([]);
  });

  it('emits the first fixup at the offset encoded in the LONG', () => {
    const text = new Uint8Array(16);
    // first LONG = 4 -> single fixup at TEXT offset 4, then terminate.
    const reloc = new Uint8Array([0, 0, 0, 4, 0]);
    const prg = buildPrg({ text, reloc });
    const offsets = [];
    walkRelocations(prg, parsed(text, reloc), (o) => offsets.push(o));
    expect(offsets).toEqual([4]);
  });

  it('handles a multi-byte stream: 4, +4 -> two fixups at 4 and 8', () => {
    const text = new Uint8Array(16);
    const reloc = new Uint8Array([0, 0, 0, 4, 4, 0]);
    const prg = buildPrg({ text, reloc });
    const offsets = [];
    walkRelocations(prg, parsed(text, reloc), (o) => offsets.push(o));
    expect(offsets).toEqual([4, 8]);
  });

  it('skips 254 bytes on byte 0x01 without emitting a fixup', () => {
    // Cover a 600-byte TEXT segment with one fixup at the start and one
    // beyond byte 254: 0x01 means "skip 254 silently", then advance 254
    // more and apply the fixup there (cursor = 4 + 254 + 254 = 512).
    const text = new Uint8Array(600);
    const reloc = new Uint8Array([0, 0, 0, 0x04, 0x01, 0xFE, 0]);
    const prg = buildPrg({ text, reloc });
    const offsets = [];
    walkRelocations(prg, parsed(text, reloc), (o) => offsets.push(o));
    expect(offsets).toEqual([4, 512]);
  });

  it('throws when the reloc table is missing the 4-byte first LONG', () => {
    const text = new Uint8Array(16);
    const reloc = new Uint8Array([0, 0, 0]); // 3 bytes — short
    const prg = buildPrg({ text, reloc });
    expect(() => walkRelocations(prg, parsed(text, reloc), () => {}))
      .toThrow(/extends past end of file/);
  });

  it('throws when the reloc stream is missing a terminator', () => {
    const text = new Uint8Array(16);
    // first LONG = 4 (one fixup) then EOF — no terminator byte.
    const reloc = new Uint8Array([0, 0, 0, 4]);
    const prg = buildPrg({ text, reloc });
    expect(() => walkRelocations(prg, parsed(text, reloc), () => {}))
      .toThrow(/missing terminator/);
  });

  it('throws when a fixup would land past TEXT+DATA', () => {
    const text = new Uint8Array(16);
    // first LONG = 14 means fixup at offset 14; 14+4 = 18 > program_size = 16.
    const reloc = new Uint8Array([0, 0, 0, 14, 0]);
    const prg = buildPrg({ text, reloc });
    expect(() => walkRelocations(prg, parsed(text, reloc), () => {}))
      .toThrow(/extend past TEXT\+DATA/);
  });
});
