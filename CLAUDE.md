# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also: `AGENTS.md` (project layout, build prereqs, code style, workflow rules), `README.md` (user-facing usage), and the upstream C tool at [`atarist-USM`](https://github.com/sidecartridge/atarist-USM) — this is a browser port.

## What this is

USM-web is a single-file browser application (`index.html`) that packages Atari ST `.PRG` / `.TOS` programs into 128 KB cartridge ROM images. It is a JavaScript port of the C tool [`atarist-USM`](https://github.com/sidecartridge/atarist-USM) and is held to **byte-for-byte parity** with that tool for the same inputs.

## Build / run / test

```sh
npm ci                 # one-time install
npm run build          # src/ → index.html  (committed; CI verifies it stays in sync)
npm test               # Vitest in node
npm run verify-goldens # diff JS output against tests/golden/*.ROM
npm run regen-goldens  # rebuild golden ROMs from the pinned upstream commit
npm run roundtrip -- path/to/file.prg   # LZSS round-trip helper (mirrors `usm -T`)
```

To use the app: open `index.html` in a modern browser. No dev server needed.

## Architecture: src/ → index.html, single concatenated module scope

Source of truth is `src/`. `build.mjs` inlines everything into one self-contained `index.html`:

- `src/template.html` — page chrome (banner, step accordion, progress bar, log pane). Contains two markers: `{{STYLES}}` (replaced by `src/styles.css` content) and `{{SCRIPT}}` (replaced by the concatenated JS body).
- `src/styles.css` — extracted from the picoflash reference; kept as a single sheet because the inlined output is one `<style>` block anyway.
- `src/stubs/prg_loader.bin`, `src/stubs/prg_loader_compressed.bin` — frozen snapshots of the 68k stub loaders from upstream `atarist-USM`. `build.mjs` reads these and emits them as `Uint8Array` constants (`PRG_LOADER`, `PRG_LOADER_COMPRESSED`) at the top of the inlined script. **Never hand-edit them.** Updating is a deliberate ceremony, not part of routine work.
- `src/lzss.js`, `src/prg.js`, `src/gemdos.js`, `src/cart-writer.js`, `src/classic-mode.js`, `src/ui.js` — concatenated in that order into one `<script type="module">` block. Each file uses ESM `export`/`import` so Vitest can import it directly during tests; `build.mjs` naively strips `export ` and `import … from …;` because all files end up in the **same** module scope after concatenation. `export default` and `export { … }` re-exports are rejected by the build — if a module needs to re-export, restructure instead.
- `build.mjs` itself is the only build dependency. No bundler, no transpiler. Output is deterministic (no timestamps, fixed file order, LF line endings).

CI invariant: `npm run build && git diff --exit-code index.html`. If that diff is non-empty, the committed `index.html` is stale and the PR is blocked.

## The byte-parity bar

The correctness criterion for the cart writer is: for any `(flags, input PRG)` combination, JS output is byte-identical to upstream `atarist-USM/usm.c` output. This is enforced by `tests/integration/*.test.js`, which diff `buildCart` output against committed golden ROMs in `tests/golden/`.

Goldens are produced by `tests/goldens.mjs` from a **pinned upstream commit** (`tests/goldens.upstream.json`). The script can either reuse a sibling `../atarist-USM/usm` binary for fast local iteration or clone the upstream repo at the pinned commit and build it. A weekly drift workflow (`.github/workflows/goldens-drift.yml`) regenerates and verifies in CI, catching silent corruption of `tests/golden/`.

## Determinism trap

`CA_TIME` / `CA_DATE` come from the input file's mtime. To keep goldens reproducible:

- `tests/goldens.upstream.json` carries both the pinned upstream commit **and** a fixed UTC `fixedMtime`.
- The goldens script `utime`s every fixture to `fixedMtime` before invoking `usm`.
- The JS integration tests inject `fixedMtime` via a `now()` hook on `src/gemdos.js`.

If you add a fixture or a flag combo, run `npm run regen-goldens` after updating `tests/goldens.flags.js`, then commit the new `tests/golden/*.ROM` alongside the source change.

## Things that bite

- **All cart writes are big-endian** — `DataView.setUint32(off, v, /*littleEndian*/ false)`. Use `writeBE32` / `writeBE16` helpers in `src/cart-writer.js`. Never write through `Uint32Array` views (native-endian).
- **`CA_NEXT` is an absolute ROM address**, not a file offset: `0xFA0000 + offsetInCart`. Forgetting the base is the classic multi-program-cart bug.
- **`prg_loader.bin` / `prg_loader_compressed.bin` are 68k machine code.** They cannot be regenerated in JavaScript. Updating them means: build the upstream `.s` source with vasm, replace `src/stubs/*.bin`, run `npm run build` (which re-emits the JS `Uint8Array` constants), regenerate goldens, commit all of it together.
- **LZSS port is byte-faithful.** The encoder makes the same greedy match decisions in the same order as `lzss_compress` in `usm.c` — different match choices produce different-but-valid bitstreams, which would fail the golden diff. If you "optimise" the encoder, the goldens fail; bump the pin and regenerate them deliberately.
- **The relocation walker contract** (`1` = skip 254, `0` = terminate) is what the PRG format requires. Don't refactor it for style.
- **Single-threaded JS**: large multi-program compressed builds can block the main thread for a noticeable beat. v1 accepts this. Web Worker offload is a future epic, not part of any current one.

## Planning artifacts

Project-level planning (Epics / Stories / Tasks, progress, design notes) lives under `docs/` at the repo root. `docs/` is **gitignored** and private to the author's local workspace. Treat it like scratch paper.

**Hard rule:** never reference the planning structure or any Epic / Story / Task identifier, number, slug, or index in any committed artifact. That means **no** mentions in:

- commit messages, PR titles, or PR descriptions
- source-code comments
- `README.md`, `AGENTS.md`, or any other file outside `docs/`

When writing a commit, describe the change in its own terms ("inline src/ into index.html", "port lzss_compress to JS") — not as "completes Story 2 of the scaffold epic".

**Branch-to-Epic rule:** one branch per **Epic**, not per Story. A Story is a single commit on the Epic's branch (or a small set of related commits). The Epic ships as one PR containing the full sequence of Story commits. Branch names describe the work area in their own terms (e.g. `feat/scaffold`, `feat/lzss`), never citing a planning ID.

## Editing guardrails

- **`index.html` is generated.** Never hand-edit it; the CI diff-check will reject the PR. Edit `src/` and re-run `npm run build`.
- **`src/stubs/*.bin` are frozen.** See "Things that bite".
- **No bundler, no transpiler, no TypeScript.** The build is `build.mjs` plus Node 20. Adding a dependency is a deliberate decision; the only runtime dependency for now is Vitest, dev-only.
- **Match existing JS style.** 2-space indent, semicolons, ES2022 modules, named functions over arrow expressions for top-level definitions, named exports only.

---

## Working style

These behavioral guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think before coding

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first

Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical changes

Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- When your changes orphan an import/variable/function, remove it. Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-driven execution

Define success criteria. Loop until verified. Here verification means: `npm run build` is clean, `npm test` is green, and (for cart-writer changes) `npm run verify-goldens` is green.

### 5. No AI attribution

Never add AI-tool attribution to commits, PR descriptions, code comments, docs, or any other artifact. This means **no**:
- "Generated with Claude Code", "Co-authored by Claude", "Made with ChatGPT", or any similar phrasing.
- `Co-Authored-By: Claude …`, `Co-Authored-By: ChatGPT …`, or any other AI co-author trailer.
- "AI-assisted", "written with the help of an LLM", etc., as comments or changelog entries.

Write the message as the human author. Do not mention AI tools used to produce the work.
