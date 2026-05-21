# Tests

USM-web's test suite has two layers, both run by Vitest in node.

## Unit tests, `tests/unit/`

Pure-function tests over `src/*.js` modules. No DOM, no filesystem reads of golden ROMs. Cover the LZSS codec, byteswap helpers, PRG header parser, GEMDOS time/date + 8.3 filename helpers, CA_HEADER builder, default / compressed / classic entry writers in isolation, the relocation walker, the in-ROM relocator, conflict rules, and the pure UI helpers (`defaultOutputName`, `formatLogLine`, `parseHexAddress`, `formatSize`).

## Integration tests, `tests/integration/`

Diff cart-writer output against committed golden ROMs in `tests/golden/`. These are the byte-parity tests against the upstream C tool, for every supported flag combination, the JS output must equal the C output byte-for-byte.

- `lzss-byte-parity.test.js` diffs `lzssCompress` against `.lz` references captured by `tests/lzss-c-harness/lzcompress` (a verbatim snapshot of upstream `lzss_compress`).
- `cart-byte-parity.test.js` diffs `buildCart` against `tests/golden/*.ROM` produced by upstream `usm` at the SHA pinned in `tests/goldens.upstream.json`.

## Running

```sh
npm ci                  # one-time install (vitest only)
npm test                # everything; ~3 seconds
npm run verify-goldens  # regenerate goldens to a temp dir and diff
npm run regen-goldens   # overwrite tests/golden/* (deliberate; commit the result)
npm run roundtrip -- tests/fixtures/hello.prg   # one-shot LZSS round-trip
```

Vitest is the only dev dependency. CI does `npm ci && npm run build && git diff --exit-code && npm test`, no C compiler, no atarist-USM checkout, fully self-contained. The committed `tests/golden/*.ROM` files are what CI compares against.

## How byte-parity is anchored

`tests/goldens.upstream.json` carries two pins:

- `upstreamCommit`, the atarist-USM SHA that produced the committed golden ROMs. Bumping it is a deliberate operation (see [`PIN-BUMP.md`](PIN-BUMP.md)).
- `fixedMtime`, a UTC timestamp that `tests/goldens.mjs` `touch`es onto every fixture before invoking `usm`. The JS integration tests inject the same timestamp into the cart writer via `mtime: new Date(fixedMtime)`. Without this, CA_TIME / CA_DATE differ by host timezone.

`tests/goldens.mjs` resolves the C `usm` binary in three priority steps:

1. `tests/.upstream-clone/usm`, cached from an earlier clone (gitignored).
2. `../atarist-USM/usm`, sibling working tree, **if** its HEAD matches the pinned SHA. Used for fast local iteration.
3. Clone the pinned SHA from `upstreamRepo` with `git fetch --depth 1` and build with `gcc -O2 usm.c -o usm`. The CI path.

If a contributor's sibling has diverged from the pin, step 2 warns and falls through to step 3 rather than silently producing different bytes.

## Drift workflow

`.github/workflows/goldens-drift.yml` runs `node tests/goldens.mjs --verify` on a weekly cron and on `workflow_dispatch`. It always uses the clone path (step 3 above). A drift means either (a) the committed goldens got hand-edited, or (b) something about `gcc -O2` on `ubuntu-latest` changed how usm.c's output renders, both worth investigating.

## Adding a fixture or a flag combo

1. Add the fixture file under `tests/fixtures/`. Document its provenance in [`fixtures/README.md`](fixtures/README.md).
2. Add the combo to `tests/goldens.flags.js` (the matrix that drives `goldens.mjs`).
3. Add a corresponding `it(...)` in `tests/integration/cart-byte-parity.test.js`.
4. `npm run regen-goldens` to capture the new `.ROM`.
5. `npm test` to confirm green.
6. Commit fixture + matrix entry + integration test + golden in one change.

## Adding a unit test

Pick a sibling file in `tests/unit/<feature>.test.js`, follow the existing patterns. Vitest auto-discovers `tests/**/*.test.js`.
