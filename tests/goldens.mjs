#!/usr/bin/env node
// Regenerate or verify the cart-writer golden ROMs against upstream usm.
//
// Modes:
//   --regen   overwrite tests/golden/*.ROM (and .STC)
//   --verify  write to a temp dir, diff against committed goldens, exit
//             non-zero on any mismatch (the default; matches CI's drift
//             workflow once Epic 006 wires the clone path).
//
// For Epic 003 this only supports the sibling-repo path: it expects
// `../atarist-USM/usm` to be already built and runnable. Epic 006 will
// extend it to clone upstream at a pinned commit and gcc-build it in CI.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, utimesSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { GOLDEN_COMBOS } from './goldens.flags.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const FIXTURES = join(HERE, 'fixtures');
const GOLDEN_DIR = join(HERE, 'golden');
const PIN = JSON.parse(readFileSync(join(HERE, 'goldens.upstream.json'), 'utf8'));

const SIBLING_USM = join(ROOT, '..', 'atarist-USM', 'usm');
const CLONE_DIR = join(HERE, '.upstream-clone');
const CLONE_USM = join(CLONE_DIR, 'usm');

// Resolve the upstream usm binary, in this priority order:
//   1. tests/.upstream-clone/usm               , built earlier from the
//      pinned SHA; reused across runs.
//   2. ../atarist-USM/usm                      , the contributor's
//      sibling working tree, when their HEAD matches the pinned SHA.
//   3. clone + gcc-build at the pinned SHA     , the CI / fresh-clone
//      path. Result lands in tests/.upstream-clone/usm.
function findOrBuildUsmBinary() {
  if (existsSync(CLONE_USM)) {
    console.log(`goldens: using cached upstream clone at ${CLONE_DIR}`);
    return CLONE_USM;
  }
  if (existsSync(SIBLING_USM)) {
    try {
      const head = execFileSync('git', ['-C', dirname(SIBLING_USM), 'rev-parse', 'HEAD'],
        { encoding: 'utf8' }).trim();
      if (head === PIN.upstreamCommit) {
        console.log(`goldens: using sibling upstream at ${SIBLING_USM} (HEAD matches pin)`);
        return SIBLING_USM;
      }
      console.warn(`goldens: sibling ../atarist-USM HEAD is ${head}, expected ${PIN.upstreamCommit}. Falling back to clone.`);
    } catch (err) {
      console.warn(`goldens: cannot verify sibling HEAD (${err.message}). Falling back to clone.`);
    }
  }
  return cloneAndBuild();
}

function cloneAndBuild() {
  console.log(`goldens: cloning ${PIN.upstreamRepo} @ ${PIN.upstreamCommit}`);
  rmSync(CLONE_DIR, { recursive: true, force: true });
  // Shallow init + fetch a single commit, cheaper than `git clone` plus
  // `git checkout`, and doesn't need history we won't use.
  mkdirSync(CLONE_DIR, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: CLONE_DIR, stdio: ['ignore', 'inherit', 'inherit'] });
  execFileSync('git', ['remote', 'add', 'origin', PIN.upstreamRepo], { cwd: CLONE_DIR });
  execFileSync('git', ['fetch', '--depth', '1', '-q', 'origin', PIN.upstreamCommit],
    { cwd: CLONE_DIR, stdio: ['ignore', 'inherit', 'inherit'] });
  execFileSync('git', ['checkout', '-q', PIN.upstreamCommit],
    { cwd: CLONE_DIR, stdio: ['ignore', 'inherit', 'inherit'] });
  console.log(`goldens: building usm with gcc`);
  execFileSync('gcc', ['-O2', 'usm.c', '-o', 'usm'],
    { cwd: CLONE_DIR, stdio: ['ignore', 'inherit', 'inherit'] });
  if (!existsSync(CLONE_USM)) {
    throw new Error('goldens: gcc finished but usm binary not found');
  }
  return CLONE_USM;
}

function normalizeMtime(path) {
  const t = new Date(PIN.fixedMtime).valueOf() / 1000;
  utimesSync(path, t, t);
}

function generateGolden(usmBin, combo, targetDir) {
  const work = join(GOLDEN_DIR, `${combo.name}.tmp`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  // Copy + normalize-mtime all required inputs.
  for (const input of combo.inputs) {
    const src = join(FIXTURES, input);
    const dst = join(work, input);
    copyFileSync(src, dst);
    normalizeMtime(dst);
  }

  // Run usm under TZ=UTC so localtime() in usm.c produces UTC-aligned
  // CA_TIME / CA_DATE, same convention the JS port uses internally.
  // See "Determinism trap" in CLAUDE.md.
  execFileSync(usmBin, combo.args, {
    cwd: work,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, TZ: 'UTC' },
  });

  // The cart name is whichever arg ends in .ROM or .STC.
  const cartArg = combo.args.find((a) => /\.(ROM|STC)$/i.test(a));
  const produced = join(work, cartArg);
  if (!existsSync(produced)) {
    throw new Error(`usm did not produce ${produced} for combo ${combo.name}`);
  }
  const out = join(targetDir, combo.output);
  copyFileSync(produced, out);
  rmSync(work, { recursive: true, force: true });
  return out;
}

function diffBytes(a, b) {
  const x = readFileSync(a);
  const y = readFileSync(b);
  if (x.length !== y.length) return { equal: false, reason: `length ${x.length} vs ${y.length}` };
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) {
      const win = 16;
      const start = Math.max(0, i - win / 2);
      const slice = (b) => Array.from(b.slice(start, start + win)).map((v) => v.toString(16).padStart(2, '0')).join(' ');
      return { equal: false, reason: `first diff at offset ${i}\n  expected: ${slice(x)}\n  actual:   ${slice(y)}` };
    }
  }
  return { equal: true };
}

function main() {
  const mode = process.argv.includes('--regen') ? 'regen' : 'verify';
  const usmBin = findOrBuildUsmBinary();
  console.log(`goldens: usm = ${usmBin}`);
  console.log(`goldens: mode = ${mode}`);

  if (mode === 'regen') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    for (const combo of GOLDEN_COMBOS) {
      const out = generateGolden(usmBin, combo, GOLDEN_DIR);
      console.log(`  + ${combo.output} (${readFileSync(out).length} bytes)`);
    }
    return;
  }

  // verify
  const tmp = join(GOLDEN_DIR, '_verify.tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  let failures = 0;
  for (const combo of GOLDEN_COMBOS) {
    const fresh = generateGolden(usmBin, combo, tmp);
    const committed = join(GOLDEN_DIR, combo.output);
    if (!existsSync(committed)) {
      console.error(`  ! ${combo.output} missing in tests/golden/ (run --regen)`);
      failures++;
      continue;
    }
    const d = diffBytes(committed, fresh);
    if (d.equal) {
      console.log(`  ok ${combo.output}`);
    } else {
      console.error(`  ! ${combo.output}: ${d.reason}`);
      failures++;
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  if (failures) {
    console.error(`\ngoldens: ${failures} mismatch(es)`);
    process.exit(1);
  }
  console.log('\ngoldens: all match');
}

main();
