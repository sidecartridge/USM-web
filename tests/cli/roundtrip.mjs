#!/usr/bin/env node
// Mirrors the hidden `usm -T <file>` debug command from atarist-USM:
// compress + decompress + byte-compare. Prints the same line on success,
// exits non-zero on mismatch. Used for manual spot-checks during the
// LZSS port.

import { readFileSync } from 'node:fs';
import { lzssRoundtrip } from '../../src/lzss.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tests/cli/roundtrip.mjs <path-to-file>');
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(path));
try {
  const { compressed, ratio } = lzssRoundtrip(bytes);
  console.log(`${path}: ${bytes.length} -> ${compressed.length} bytes (${ratio.toFixed(1)}%) OK`);
} catch (err) {
  console.error(`${path}: ${err.message}`);
  process.exit(1);
}
