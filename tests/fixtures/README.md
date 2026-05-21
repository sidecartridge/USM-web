# Test fixtures

Inputs for the cart-writer integration tests. Two policies coexist here:

## Tracked

These are freely redistributable and live in the repo. CI uses them.

| File             | Source                                      | Use |
| ---------------- | ------------------------------------------- | --- |
| `hello.prg`      | Upstream `atarist-USM/tests/fixtures/`      | 88-byte minimal PRG. Anchor for default / classic / `-s` / `-f` / `-d` golden combos. |
| `hello.s`        | Upstream `atarist-USM/tests/fixtures/`      | 68k assembly source for the above (reference only). |
| `synth.prg`      | Generated locally (see [`scripts`](#regenerating-synthprg)) | 1308-byte PRG built from `synthetic.bin`'s pattern. Compresses to ~731 bytes, so `-z` does *not* auto-fall-back. Anchor for the `-z` golden combos. |
| `synthetic.bin`  | Generated locally                           | Raw 1280-byte byte pattern used as `synth.prg`'s TEXT and as a standalone LZSS input. |
| `reloc.prg`      | Generated locally                           | 50-byte PRG with two fixups (one TEXT-internal, one BSS). Anchor for classic-mode and diagnostic golden combos. |
| `lzss/*.lz`      | `tests/lzss-c-harness/lzcompress`           | Byte-parity references for `lzssCompress`. Captured from a verbatim snapshot of upstream `lzss_compress`. |

## Not tracked

Third-party PRGs from `atarist-USM/tests/binaries/` (MONST2, RAID, SYSINFO, SILYCMP, SWITV310) are not redistributable here and are NOT committed. The corresponding golden ROMs are also not committed.

If a contributor places those files at `tests/binaries/<NAME>.PRG` locally, they can extend `tests/goldens.flags.js` and `tests/goldens.mjs` to cover the additional combos. This is local-only. CI never sees them.

## Regenerating `synth.prg`

```sh
node -e "
import('node:fs').then(({readFileSync, writeFileSync}) => {
  const pattern = new Uint8Array(readFileSync('tests/fixtures/synthetic.bin'));
  const TSIZE = pattern.length;
  const buf = new Uint8Array(28 + TSIZE);
  const v = new DataView(buf.buffer);
  v.setUint16(0, 0x601A, false);
  v.setUint32(2, TSIZE, false);
  v.setUint16(26, 1, false);   // absflag = 1 -> no fixups
  buf.set(pattern, 28);
  writeFileSync('tests/fixtures/synth.prg', buf);
});
"
```

Re-running this with the same `synthetic.bin` produces byte-identical output. If you change `synth.prg`, re-run `npm run regen-goldens` and commit both.

## Regenerating `reloc.prg`

```sh
node -e "
import('node:fs').then(({writeFileSync}) => {
  const buf = new Uint8Array(50);
  const v = new DataView(buf.buffer);
  v.setUint16(0, 0x601A, false);     // PRG magic
  v.setUint32(2, 16, false);          // tsize
  v.setUint16(26, 0, false);          // absflag = 0 -> has fixups
  v.setUint32(28, 0x4E714E71, false); // NOP NOP
  v.setUint32(32, 0x0000000C, false); // fixup -> TEXT offset 12
  v.setUint32(36, 0x00000020, false); // fixup -> BSS  (off > program_size)
  v.setUint32(40, 0x4E714E71, false); // NOP NOP
  v.setUint32(44, 4, false);          // reloc first LONG = 4
  buf[48] = 4;                          // advance 4 -> second fixup at 8
  buf[49] = 0;                          // terminator
  writeFileSync('tests/fixtures/reloc.prg', buf);
});
"
```
