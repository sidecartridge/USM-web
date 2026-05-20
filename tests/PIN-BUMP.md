# Bumping the upstream pin

`tests/goldens.upstream.json` pins the atarist-USM SHA that produced the committed `tests/golden/*.ROM`. Bumping it is the one operation that legitimately changes those golden bytes.

## When to do it

- Upstream landed a real change (new flag, bug fix, output-byte-affecting refactor) and we want USM-web's byte-parity tests to match the new behavior.
- The drift workflow opened an issue — but **investigate first**: drift on a pin that hasn't moved means either the committed goldens got hand-edited, or the upstream repo was force-pushed, or something about the CI toolchain changed. Don't reflexively bump the pin to silence the alarm.

## Steps

1. **Pick the new SHA.** From `https://github.com/sidecartridge/atarist-USM/commits/main`. Use the full 40-char hash.

2. **Update the JSON.**
   ```sh
   $EDITOR tests/goldens.upstream.json     # change upstreamCommit
   ```

3. **Regenerate the goldens.** This downloads the pinned tree, builds usm with gcc, and overwrites every `tests/golden/*.ROM`.
   ```sh
   rm -rf tests/.upstream-clone            # force a fresh clone
   npm run regen-goldens
   ```

4. **Eyeball the diff.** `git diff --stat tests/golden/` shows which goldens changed. Any byte delta beyond what you expected from the upstream commits is a red flag — read the upstream log:
   ```sh
   git -C tests/.upstream-clone log --oneline <OLD_SHA>..HEAD
   ```
   If the diff looks unexplained, stop and investigate. Don't ship a pin bump that silently rewrites bytes you can't account for.

5. **Run the full suite.**
   ```sh
   npm test
   ```
   All integration tests must remain green against the new goldens.

6. **Commit pin + goldens + any matrix updates in one change.**
   ```sh
   git add tests/goldens.upstream.json tests/golden/
   git commit -m "Bump upstream pin to <SHA>"
   ```
   The commit message body should list the upstream commits the bump pulls in (one line each), plus any non-obvious golden-byte deltas.

## Adding a flag combo at the same time as a bump

Append the new entry to `tests/goldens.flags.js` and the corresponding `it(...)` to `tests/integration/cart-byte-parity.test.js` first, then `npm run regen-goldens` to generate the new golden alongside the bumped ones. One commit, complete picture.

## Things that bite

- **Don't hand-edit the JSON's `fixedMtime`.** It's there to make CA_TIME / CA_DATE deterministic; changing it would diff every golden's header for the worst possible reason.
- **The cache is intentional.** `tests/.upstream-clone/` is `gitignore`d and reused across runs. If you suspect the cached binary is stale, `rm -rf tests/.upstream-clone` and re-run.
- **Sibling override.** If `../atarist-USM` exists and its HEAD matches the new pin, `goldens.mjs` uses that binary directly (fast). If it diverges, it warns and falls through to the clone — the warning is enough; you don't need to do anything.
