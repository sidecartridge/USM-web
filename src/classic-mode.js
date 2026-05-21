// Classic-mode in-ROM relocator. Rewrites every absolute address in
// TEXT+DATA so the program can run in place from cart ROM:
//   - References that point into TEXT+DATA become
//     (CART_ROM_BASE + programOffsetInCart + originalValue).
//   - References that point into BSS become
//     (bssAddr + originalValue - program_size).
// Skipped entirely when the PRG's ABSFLAG is non-zero (the program
// already promised it has no fixups).
//
// Mirrors usm.c:762-813. Both the read of the fixup site and the write
// of the rewritten value go through DataView big-endian.

import { walkRelocations } from './prg.js';
import { CART_ROM_BASE } from './cart-writer.js';

// Returns the number of fixups applied (0 when ABSFLAG short-circuits
// the pass or when the PRG has the alt-encoded no-fixups first LONG).
// The count feeds the verbose log line for classic-mode entries.
export function relocateTextData(view, programOffsetInCart, prgBuf, prgHeader, bssAddr) {
  if (prgHeader.absflag !== 0) return 0; // no fixups requested

  const programSize = prgHeader.tsize + prgHeader.dsize;
  const programStartAddr = (CART_ROM_BASE + programOffsetInCart) >>> 0;

  let applied = 0;
  walkRelocations(prgBuf, prgHeader, (offsetInTextData) => {
    const cartOffset = programOffsetInCart + offsetInTextData;
    const original = view.getUint32(cartOffset, /*littleEndian*/ false);
    const rewritten = original < programSize
      ? (programStartAddr + original) >>> 0
      : (bssAddr + original - programSize) >>> 0;
    view.setUint32(cartOffset, rewritten, /*littleEndian*/ false);
    applied++;
  });
  return applied;
}
