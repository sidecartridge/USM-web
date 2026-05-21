// Cart-writer primitives. All multi-byte cart fields are 68k big-endian;
// these wrappers exist so there's one grep target ("writeBE") for every
// such write and so the intent matches BYTESWAP_LONG / BYTESWAP_WORD in
// atarist-USM/usm.c.

import { PRG_LOADER, PRG_LOADER_COMPRESSED } from './prg-loader.js';
import { gemdosTimeDate, toEightThreeName } from './gemdos.js';
import { lzssCompress } from './lzss.js';
import { parsePrgHeader, PRG_HEADER_SIZE } from './prg.js';
import { relocateTextData } from './classic-mode.js';

export function writeBE32(view, offset, value) {
  view.setUint32(offset, value >>> 0, /*littleEndian*/ false);
}

export function writeBE16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, /*littleEndian*/ false);
}

// CA_HEADER record layout (34 bytes) — matches the struct at
// atarist-USM/usm.c:29-47.
export const CA_HEADER_SIZE = 34;

// Cart ROM is mapped at 0xFA0000 on the Atari ST. Addresses that go into
// CA_NEXT / CA_RUN / CA_INIT are (this base) + offset-in-cart.
export const CART_ROM_BASE = 0xFA0000;

// Encode the -f init flag (0 / 1 / 3 / 5 / 6 / 7) into the bit set in
// the top byte of CA_INIT. Mirrors usm.c:144 `1 << (24 + (*p - '0'))`.
// Throws on unsupported flag values rather than silently producing junk.
export function encodeInitFlag(flag) {
  if (![0, 1, 3, 5, 6, 7].includes(flag)) {
    throw new Error(`encodeInitFlag: -f expects 0, 1, 3, 5, 6, or 7 (got ${flag})`);
  }
  return (1 << (24 + flag)) >>> 0;
}

// Write a CA_HEADER record into `view` at `offset`. All multi-byte
// fields are big-endian. `filename` must be a 14-byte Uint8Array already
// uppercased + NUL-padded by toEightThreeName.
//
// Field address arithmetic lives at the call site (see Story 7): this
// helper is byte-layout only so the cart writer's tests can pin every
// field independently.
export function writeCaHeader(view, offset, fields) {
  const { next, init, run, time, date, size, filename } = fields;
  if (!(filename instanceof Uint8Array) || filename.length !== 14) {
    throw new Error('writeCaHeader: filename must be a 14-byte Uint8Array');
  }
  writeBE32(view, offset + 0,  next);
  writeBE32(view, offset + 4,  init);
  writeBE32(view, offset + 8,  run);
  writeBE16(view, offset + 12, time);
  writeBE16(view, offset + 14, date);
  writeBE32(view, offset + 16, size);
  const dst = new Uint8Array(view.buffer, view.byteOffset + offset + 20, 14);
  dst.set(filename);
}

// Default-mode entry layout (per atarist-USM/usm.c:836-849):
//   [ CA_HEADER (34 B) ][ prg_loader stub (236 B) ][ verbatim PRG bytes ]
// Returns the number of bytes written (== CA_HEADER + stub + prg.length).
// Caller must word-align after the call if the total is odd (`usm.c:854-857`).
//
// `nextEntryAddr` is the absolute ROM address the CA_NEXT field should
// point at. The C tool resolves it as
// `CART_ROM_BASE + offset + entry_total_size_padded` before writing the
// header; for the last entry, the caller patches CA_NEXT to 0 after the
// whole chain has been laid out.
//
// `initFlagDigit` is the -fY digit (0/1/3/5/6/7) or null/undefined for
// "no auto-run flag set" — the C tool's distinction between
// "global_init_flag = 0" (no -f anywhere) and "-f0".
export function writeDefaultEntry(view, offset, prgBytes, opts) {
  const { name, initFlagDigit, mtime, nextEntryAddr } = opts;
  if (!(prgBytes instanceof Uint8Array)) {
    throw new Error('writeDefaultEntry: prgBytes must be a Uint8Array');
  }
  const payload_in_cart = PRG_LOADER.length + prgBytes.length;
  const entryAddr = CART_ROM_BASE + offset;
  const stubAddr = entryAddr + CA_HEADER_SIZE;
  const filename = toEightThreeName(name);
  const { time, date } = gemdosTimeDate(mtime);
  const init = initFlagDigit == null
    ? 0
    : ((encodeInitFlag(initFlagDigit) + stubAddr) >>> 0);

  writeCaHeader(view, offset, {
    next: nextEntryAddr >>> 0,
    init,
    run: stubAddr >>> 0,
    time,
    date,
    size: payload_in_cart,
    filename,
  });

  const dst = new Uint8Array(view.buffer, view.byteOffset + offset + CA_HEADER_SIZE, payload_in_cart);
  dst.set(PRG_LOADER, 0);
  dst.set(prgBytes, PRG_LOADER.length);

  return CA_HEADER_SIZE + payload_in_cart;
}

export const CART_SIZE = 128 * 1024;
export const CART_MAGIC = 0xABCDEF42;
export const CART_MAGIC_DIAGNOSTIC = 0xfa52235f;
export const STEEM_PREFIX_SIZE = 4;

export class CartOverflowError extends Error {
  constructor(name, footprint, remaining) {
    super(`File ${name} will not fit in image (entry footprint ${footprint} bytes, ${remaining} bytes remaining)`);
    this.name = 'CartOverflowError';
    this.entryFootprint = footprint;
    this.remaining = remaining;
  }
}

// Run LZSS-12-4 on prgBytes and decide whether the compressed entry is
// actually smaller than the uncompressed one. Matches the auto-fallback
// rule in usm.c:638 — compressed_entry < uncompressed_entry counts the
// difference between the 236-byte and 304-byte stubs, so tiny inputs
// usually fail the test even when the raw data shrinks.
//
// Returns:
//   { kind: 'compressed', compressed, dataRatio }  -> caller should
//      writeCompressedEntry, log "compressed N -> M (RATIO%)".
//   { kind: 'fallback', entryRatio }               -> caller should
//      writeDefaultEntry, log "no savings (RATIO% entry), shipping
//      uncompressed".
export function tryCompress(prgBytes) {
  const compressed = lzssCompress(prgBytes);
  const uncompFootprint = PRG_LOADER.length + prgBytes.length;
  const compFootprint = PRG_LOADER_COMPRESSED.length + 4 + compressed.length;
  if (compFootprint < uncompFootprint) {
    const dataRatio = (compressed.length / prgBytes.length) * 100;
    return { kind: 'compressed', compressed, dataRatio };
  }
  const entryRatio = (compFootprint / uncompFootprint) * 100;
  return { kind: 'fallback', entryRatio };
}

// Compressed-mode entry layout (per usm.c:817-833):
//   [ CA_HEADER (34 B) ][ prg_loader_compressed (304 B) ]
//   [ uncompressed_size LONG, big-endian (4 B) ][ compressed payload ]
// Caller is responsible for choosing this path only when tryCompress
// returned kind === 'compressed'. Same word-alignment rule applies
// after the call.
export function writeCompressedEntry(view, offset, prgBytes, compressed, opts) {
  const { name, initFlagDigit, mtime, nextEntryAddr } = opts;
  if (!(prgBytes instanceof Uint8Array) || !(compressed instanceof Uint8Array)) {
    throw new Error('writeCompressedEntry: prgBytes and compressed must be Uint8Arrays');
  }
  const payload_in_cart = PRG_LOADER_COMPRESSED.length + 4 + compressed.length;
  const entryAddr = CART_ROM_BASE + offset;
  const stubAddr = entryAddr + CA_HEADER_SIZE;
  const filename = toEightThreeName(name);
  const { time, date } = gemdosTimeDate(mtime);
  const init = initFlagDigit == null
    ? 0
    : ((encodeInitFlag(initFlagDigit) + stubAddr) >>> 0);

  writeCaHeader(view, offset, {
    next: nextEntryAddr >>> 0,
    init,
    run: stubAddr >>> 0,
    time,
    date,
    size: payload_in_cart,
    filename,
  });

  // Stub + uncompressed-size LONG (big-endian) + compressed payload.
  let cursor = offset + CA_HEADER_SIZE;
  const stub = new Uint8Array(view.buffer, view.byteOffset + cursor, PRG_LOADER_COMPRESSED.length);
  stub.set(PRG_LOADER_COMPRESSED);
  cursor += PRG_LOADER_COMPRESSED.length;
  writeBE32(view, cursor, prgBytes.length);
  cursor += 4;
  const payload = new Uint8Array(view.buffer, view.byteOffset + cursor, compressed.length);
  payload.set(compressed);

  return CA_HEADER_SIZE + payload_in_cart;
}

// Classic-mode entry layout (per usm.c:750-815):
//   [ CA_HEADER (34 B, omitted when diagnostic) ][ relocated TEXT+DATA ]
// No stub, no PRG header. program_size = (tsize+dsize+1) & ~1 — the
// extra byte (when the file is odd-sized) comes from the byte after
// TEXT+DATA in the original PRG, matching usm.c:623.
//
// `prgHeader` is the parsed PRG header; `prgBuf` is the raw file bytes
// (the relocator needs both to walk the reloc table).
//
// Returns the number of bytes written from `offset` (== CA_HEADER_SIZE
// + program_size unless diagnostic, in which case program_size only).
// Returns { bytesWritten, fixups }. The fixups count is what the
// verbose log shows.
export function writeClassicEntry(view, offset, prgBuf, prgHeader, opts) {
  const { name, initFlagDigit, mtime, nextEntryAddr, bssAddr, diagnostic } = opts;
  if (!(prgBuf instanceof Uint8Array)) {
    throw new Error('writeClassicEntry: prgBuf must be a Uint8Array');
  }

  const program_size = (prgHeader.tsize + prgHeader.dsize + 1) & ~1;

  let programOffsetInCart;
  let bytesWritten;
  if (diagnostic) {
    // Diagnostic carts skip the CA_HEADER entirely — the OS jumps
    // straight to programOffsetInCart after reset.
    programOffsetInCart = offset;
    bytesWritten = program_size;
  } else {
    programOffsetInCart = offset + CA_HEADER_SIZE;
    bytesWritten = CA_HEADER_SIZE + program_size;
    const entryAddr = CART_ROM_BASE + offset;
    const programAddr = CART_ROM_BASE + programOffsetInCart;
    const filename = toEightThreeName(name);
    const { time, date } = gemdosTimeDate(mtime);
    const init = initFlagDigit == null
      ? 0
      : ((encodeInitFlag(initFlagDigit) + programAddr) >>> 0);
    writeCaHeader(view, offset, {
      next: nextEntryAddr >>> 0,
      init,
      run: programAddr >>> 0,
      time,
      date,
      size: program_size,
      filename,
    });
  }

  // Copy TEXT+DATA verbatim from the PRG file.
  const programDst = new Uint8Array(view.buffer, view.byteOffset + programOffsetInCart, program_size);
  programDst.set(prgBuf.subarray(PRG_HEADER_SIZE, PRG_HEADER_SIZE + program_size));

  // Apply in-place relocations against the cart-resident copy.
  const fixups = relocateTextData(view, programOffsetInCart, prgBuf, prgHeader, bssAddr);

  return { bytesWritten, fixups };
}

// Build a complete cart image from a list of programs. v1 scope: default
// mode + -z (compressed) + multi-program + -s (STEem prefix) + -fY
// (init flag, per-program). Classic (-c) and diagnostic (-d) throw
// until Epic 004 lands.
//
// `programs` is an array of resolved per-program options:
//   { name, bytes, compress, initFlagDigit, mtime }
// The UI (Epic 005) resolves global -> per-file flag inheritance before
// calling this.
//
// `onLogLine` (optional) receives structured events for the log pane:
//   { type: 'compressed', name, origSize, compSize, dataRatio }
//   { type: 'fallback',   name, entryRatio }
//
// Returns a Uint8Array: 128 KB normally, or 128 KB + 4 with steem=true.
export const DEFAULT_BSS_ADDR = 0x20000;

export function buildCart({
  programs,
  steem = false,
  diagnostic = false,
  classic = false,
  globalBssAddr = DEFAULT_BSS_ADDR,
  onLogLine,
}) {
  if (!Array.isArray(programs) || programs.length === 0) {
    throw new Error('buildCart: programs must be a non-empty array');
  }
  // Conflict rules. Order matches usm.c: global -z+-c and -z+-d checks
  // run first (usm.c:458-467), then the per-program -d-requires-c check
  // (usm.c:613-621). Diagnostic-implies-single-program is enforced when
  // we get to actual entry layout (usm.c:861-868).
  for (const p of programs) {
    if (p.compress && classic) {
      throw new Error(`buildCart: -z and -c are incompatible (program "${p.name}")`);
    }
    if (p.compress && diagnostic) {
      throw new Error(`buildCart: -z and -d are incompatible (program "${p.name}")`);
    }
  }
  if (diagnostic && !classic) {
    throw new Error('buildCart: -d (diagnostic) requires -c (classic mode)');
  }
  if (diagnostic && programs.length !== 1) {
    throw new Error('buildCart: diagnostic carts must contain exactly one program');
  }

  const cart = new Uint8Array(CART_SIZE);
  fillUsmPattern(cart);
  const view = new DataView(cart.buffer);

  // Cart magic at offset 0.
  writeBE32(view, 0, diagnostic ? CART_MAGIC_DIAGNOSTIC : CART_MAGIC);
  let offset = 4;

  // Pre-compute each entry's payload + padded footprint so we can resolve
  // CA_NEXT at write time. Compression runs here, too — caller-visible
  // log events are emitted in this loop so the UI streams them in the
  // same order as the C tool's stdout.
  const entryPlans = programs.map((p) => {
    if (!(p.bytes instanceof Uint8Array)) {
      throw new Error(`buildCart: program "${p.name}" bytes must be a Uint8Array`);
    }
    if (classic) {
      const header = parsePrgHeader(p.bytes);
      const programSize = (header.tsize + header.dsize + 1) & ~1;
      const entrySize = diagnostic ? programSize : CA_HEADER_SIZE + programSize;
      const paddedSize = (entrySize + 1) & ~1;
      return { ...p, header, kind: 'classic', entrySize, paddedSize };
    }
    // Non-classic: default or compressed. Parse the header up front for
    // the verbose log (the entry writers themselves don't need it for
    // the default/compressed paths, but the user wants to see it).
    const header = parsePrgHeader(p.bytes);
    let kind = 'default';
    let compressed = null;
    let payloadSize = PRG_LOADER.length + p.bytes.length;
    let compressionEvent = null;
    if (p.compress) {
      const result = tryCompress(p.bytes);
      if (result.kind === 'compressed') {
        kind = 'compressed';
        compressed = result.compressed;
        payloadSize = PRG_LOADER_COMPRESSED.length + 4 + compressed.length;
        compressionEvent = {
          type: 'compressed',
          name: p.name,
          origSize: p.bytes.length,
          compSize: compressed.length,
          dataRatio: result.dataRatio,
        };
      } else {
        compressionEvent = {
          type: 'fallback',
          name: p.name,
          entryRatio: result.entryRatio,
        };
      }
    }
    const entrySize = CA_HEADER_SIZE + payloadSize;
    const paddedSize = (entrySize + 1) & ~1;
    return { ...p, header, kind, compressed, entrySize, paddedSize, compressionEvent };
  });

  // Write each entry. CA_NEXT for entry i points at where entry i+1's
  // CA_HEADER will land; for the last entry (or any entry in diagnostic
  // mode, which has no CA_NEXT chain), CA_NEXT = 0.
  for (let i = 0; i < entryPlans.length; i++) {
    const e = entryPlans[i];
    const remaining = CART_SIZE - offset;
    if (e.paddedSize > remaining) {
      throw new CartOverflowError(e.name, e.paddedSize, remaining);
    }
    const nextEntryAddr = (!diagnostic && i + 1 < entryPlans.length)
      ? CART_ROM_BASE + offset + e.paddedSize
      : 0;
    const baseOpts = {
      name: e.name,
      initFlagDigit: e.initFlagDigit ?? null,
      mtime: e.mtime,
      nextEntryAddr,
    };

    // Per-program verbose log: announce, header fields, layout, then
    // any pre-computed compression event for this program.
    onLogLine?.({ type: 'program-start', name: e.name, index: i + 1, total: entryPlans.length });
    onLogLine?.({
      type: 'header',
      name: e.name,
      tsize: e.header.tsize,
      dsize: e.header.dsize,
      bsize: e.header.bsize,
      ssize: e.header.ssize,
      prgflags: e.header.prgflags,
      absflag: e.header.absflag,
    });
    const caHeaderAddr = diagnostic ? null : (CART_ROM_BASE + offset) >>> 0;
    const payloadAddr = (CART_ROM_BASE + offset + (diagnostic ? 0 : CA_HEADER_SIZE)) >>> 0;
    onLogLine?.({
      type: 'layout',
      name: e.name,
      mode: e.kind,
      diagnostic,
      caHeaderAddr,
      payloadAddr,
      payloadSize: e.entrySize - (diagnostic ? 0 : CA_HEADER_SIZE),
      paddedSize: e.paddedSize,
    });
    if (e.compressionEvent) onLogLine?.(e.compressionEvent);

    if (e.kind === 'classic') {
      const { fixups } = writeClassicEntry(view, offset, e.bytes, e.header, {
        ...baseOpts,
        bssAddr: e.bssAddr ?? globalBssAddr,
        diagnostic,
      });
      onLogLine?.({
        type: 'fixups',
        name: e.name,
        count: fixups,
        bssAddr: e.bssAddr ?? globalBssAddr,
      });
    } else if (e.kind === 'compressed') {
      writeCompressedEntry(view, offset, e.bytes, e.compressed, baseOpts);
    } else {
      writeDefaultEntry(view, offset, e.bytes, baseOpts);
    }
    offset += e.paddedSize;
  }

  // Final summary. usmFillBytes is the count of cart bytes at the tail
  // still matching the cyclic USM! pattern at their offsets — bytes
  // overwritten by entries (or by entries' padding zero) don't count.
  const usmFillBytes = countTrailingUsmFill(cart);
  onLogLine?.({
    type: 'summary',
    totalBytes: CART_SIZE + (steem ? STEEM_PREFIX_SIZE : 0),
    programCount: entryPlans.length,
    usmFillBytes,
    steem,
  });

  if (steem) {
    const prefixed = new Uint8Array(STEEM_PREFIX_SIZE + CART_SIZE);
    prefixed.set(cart, STEEM_PREFIX_SIZE);
    return prefixed;
  }
  return cart;
}

// Count trailing bytes of the cart that still match the cyclic USM!
// pattern at their respective offsets. Used by the verbose log's
// summary line to report how much of the cart is unused fill.
function countTrailingUsmFill(cart) {
  const pat = [0x55, 0x53, 0x4D, 0x21]; // 'U' 'S' 'M' '!'
  let count = 0;
  for (let i = cart.length - 1; i >= 0; i--) {
    if (cart[i] !== pat[i & 3]) break;
    count++;
  }
  return count;
}

// Fill the 128 KB cart buffer with the literal "USM!" pattern (cyclic
// 4-byte fill, matching usm.c:473-480). Byte-visible in hex dumps for
// any unused region of the cart.
function fillUsmPattern(cart) {
  for (let i = 0; i < cart.length; i += 4) {
    cart[i] = 0x55;     // 'U'
    cart[i + 1] = 0x53; // 'S'
    cart[i + 2] = 0x4D; // 'M'
    cart[i + 3] = 0x21; // '!'
  }
}
