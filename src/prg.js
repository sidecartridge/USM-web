// PRG header parsing, matches the PRG_HEADER struct in
// atarist-USM/usm.c:49-59. The header is 28 bytes, big-endian
// throughout, prefixing TEXT, DATA, BSS, symbol-table, and relocation
// sections in a standard Atari ST executable.

export const PRG_HEADER_SIZE = 28;
export const PRG_MAGIC = 0x601A;

// 128 KB upper bound, same as the cart buffer ceiling in usm.c. Anything
// larger can't physically fit in a cart even if its only entry, so we
// reject at the parser layer to fail fast.
export const PRG_MAX_FILE_SIZE = 128 * 1024;

export function parsePrgHeader(buf) {
  if (!(buf instanceof Uint8Array)) {
    throw new Error('parsePrgHeader: expected a Uint8Array');
  }
  if (buf.length < PRG_HEADER_SIZE) {
    throw new Error(`parsePrgHeader: file is ${buf.length} bytes, need at least ${PRG_HEADER_SIZE}`);
  }
  if (buf.length > PRG_MAX_FILE_SIZE) {
    throw new Error(`parsePrgHeader: file is ${buf.length} bytes, exceeds the 128 KB cart limit`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint16(0, /*littleEndian*/ false);
  if (magic !== PRG_MAGIC) {
    throw new Error(`parsePrgHeader: bad magic 0x${magic.toString(16).padStart(4, '0')}, expected 0x601A`);
  }
  return {
    magic,
    tsize:    view.getUint32(2,  false),
    dsize:    view.getUint32(6,  false),
    bsize:    view.getUint32(10, false),
    ssize:    view.getUint32(14, false),
    res1:     view.getUint32(18, false),
    prgflags: view.getUint32(22, false),
    absflag:  view.getUint16(26, false),
  };
}

// Walk the PRG relocation byte-stream and yield each fixup offset, all
// expressed relative to the start of TEXT+DATA. Matches the loop at
// atarist-USM/usm.c:766-812.
//
// PRG reloc format:
//   - 4 bytes: first offset (big-endian LONG). If 0, the PRG has no
//     fixups (the spec's alt encoding); the walker yields nothing.
//   - Otherwise the cursor advances by that LONG; emit a fixup at the
//     new position.
//   - Then a stream of bytes:
//       0x01           -> advance cursor by 254 (no fixup emitted)
//       0x00           -> terminator
//       any other byte -> advance cursor by that value, emit a fixup at
//                         the new position
//
// `prgHeader` is the parsed header (so we know tsize+dsize for the
// fixup-site bounds). The reloc table starts at
// `PRG_HEADER_SIZE + tsize + dsize + ssize`.
//
// `onFixup(offsetInTextData)` is called for each fixup. Throws if the
// reloc table is truncated, missing its 4-byte first-LONG, missing its
// terminator, or if a fixup would land past program_size - 4.
export function walkRelocations(prgBuf, prgHeader, onFixup) {
  if (!(prgBuf instanceof Uint8Array)) {
    throw new Error('walkRelocations: expected a Uint8Array');
  }
  const programSize = prgHeader.tsize + prgHeader.dsize;
  const relocStart = PRG_HEADER_SIZE + prgHeader.tsize + prgHeader.dsize + prgHeader.ssize;
  const relocEnd = prgBuf.length;

  if (relocStart + 4 > relocEnd) {
    throw new Error('walkRelocations: relocation table extends past end of file');
  }

  const view = new DataView(prgBuf.buffer, prgBuf.byteOffset, prgBuf.byteLength);
  let first = view.getUint32(relocStart, /*littleEndian*/ false);
  if (first === 0) return; // no fixups

  let cursor = first; // offset into TEXT+DATA where the first fixup lives
  if (cursor + 4 > programSize) {
    throw new Error(`walkRelocations: first fixup at offset ${cursor} would extend past TEXT+DATA (${programSize})`);
  }
  onFixup(cursor);

  let relocPos = relocStart + 4;
  while (true) {
    if (relocPos >= relocEnd) {
      throw new Error('walkRelocations: relocation table missing terminator');
    }
    const b = prgBuf[relocPos++];
    if (b === 0) return; // terminator
    if (b === 1) {
      cursor += 254;
      continue;
    }
    cursor += b;
    if (cursor + 4 > programSize) {
      throw new Error(`walkRelocations: fixup at offset ${cursor} would extend past TEXT+DATA (${programSize})`);
    }
    onFixup(cursor);
  }
}
