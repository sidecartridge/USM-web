# AGENTS.md

This repository contains **USM-web**, a single-file browser application that packages Atari ST `.PRG` / `.TOS` programs into 128 KB cartridge ROM images. It is a JavaScript port of the C tool [`atarist-USM`](https://github.com/sidecartridge/atarist-USM). See `CLAUDE.md` for architecture details and `README.md` for end-user usage.

---

## Project layout

- `index.html` — generated artifact. Committed; produced by `build.mjs` from `src/`. CI rejects PRs where this drifts.
- `build.mjs` — Node ESM script that inlines `src/template.html` + `src/styles.css` + `src/*.js` + `src/stubs/*.bin` into `index.html`.
- `src/template.html` — page chrome with `{{STYLES}}` / `{{SCRIPT}}` markers.
- `src/styles.css` — single stylesheet, extracted from the upstream picoflash reference.
- `src/stubs/prg_loader.bin`, `src/stubs/prg_loader_compressed.bin` — 68k machine code, frozen snapshots from `atarist-USM`. Never hand-edit.
- `src/lzss.js`, `src/prg.js`, `src/gemdos.js`, `src/cart-writer.js`, `src/classic-mode.js`, `src/ui.js` — ESM modules. Concatenated into one module scope by the build.
- `tests/unit/`, `tests/integration/` — Vitest. Unit tests cover pure functions; integration tests diff cart-writer output against committed golden ROMs.
- `tests/fixtures/` — input PRG files. Only freely-distributable fixtures are tracked; third-party PRGs go in a contributor's local workspace.
- `tests/golden/` — committed golden ROMs produced by upstream `usm` at a pinned commit. CI's drift workflow re-verifies these.
- `tests/goldens.mjs`, `tests/goldens.upstream.json`, `tests/goldens.flags.js` — regen tooling and pin metadata.
- `.github/workflows/test.yml` — PR / push CI: build, diff `index.html`, test.
- `.github/workflows/goldens-drift.yml` — weekly + manual: rebuild upstream `usm`, regenerate goldens, diff. *(Added in a later epic.)*
- `docs/` — private planning (gitignored). Never reference its contents in committed artifacts.

---

## Prerequisites

- **Node.js 20+** — the runtime for the build, tests, and goldens script.
- **gcc** — only needed locally if you regenerate golden ROMs from source rather than using a pre-built sibling `../atarist-USM/usm`. Standard `apt`/`brew` install.
- **Git** — for the drift workflow's `git clone` of the pinned upstream commit.

No package manager other than npm. No bundler. No TypeScript.

---

## Build commands

```sh
npm ci                 # one-time install (vitest only)
npm run build          # src/ → index.html
npm test               # Vitest in node
npm run verify-goldens # diff JS output vs tests/golden/*.ROM
npm run regen-goldens  # rebuild goldens (uses sibling ../atarist-USM/usm if present, else clones the pinned commit)
npm run roundtrip -- path/to/file.prg   # LZSS round-trip helper (mirrors `usm -T`)
```

A direct `node build.mjs` is equivalent to `npm run build`. The script is deterministic — running it twice with no source changes produces an identical `index.html`.

---

## Code style

- **2-space indent**, semicolons, ES2022 syntax. No Prettier config yet; match what's already there.
- **Named exports only.** `export default` and `export { … }` re-exports are rejected by the build (they don't make sense in a single concatenated module scope).
- **Modules don't `import` from sibling `src/` modules at runtime** — they reference each other's top-level names as if in one scope, because that's what the build produces. The `import` statements in source are there for Vitest's benefit; the build strips them.
- **Big-endian everywhere** for cart data: `DataView` with the third argument set to `false`. Never `Uint32Array` views.
- **Match `atarist-USM/usm.c` variable names** in the ported codec / cart-writer modules where reasonable. Reviewers diff side-by-side.
- **No new runtime dependencies** without explicit user approval. Dev dependencies require a justification in the PR description.

---

## Workflow rules for agents

- Do not discard or overwrite local changes without explicit user approval.
- Do not push to the remote, open PRs, or merge without explicit user approval.
- Do not amend or force-push commits unless explicitly asked.
- One branch per Epic. A Story is one (or a small set of) commits on that branch. Branch names describe the work area (`feat/lzss`), never citing planning IDs.
- Never reference Epic / Story / Task IDs in commit messages, PR titles/bodies, or source comments.
- No AI attribution anywhere. No `Co-Authored-By: Claude …` trailers, no "Generated with …" footers, no comments like "// added by AI".
- When the cart writer changes, also run `npm run verify-goldens` before considering the change complete. If goldens need to change, regenerate via the documented runbook — don't hand-edit them.
- When `src/` changes, always rebuild `index.html` and commit it in the same change. CI will block otherwise.

---

## "Done" checklist

- `npm ci && npm run build` produces an `index.html` matching the committed file.
- `npm test` is green.
- `npm run verify-goldens` is green (after Epic 006's goldens land).
- No new runtime dependencies introduced silently.
- No references to planning artifacts in committed text.
- The change has been exercised end-to-end (for cart-writer changes: load the produced ROM in Hatari).
