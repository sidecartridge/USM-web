// Flag-combo matrix for golden ROM generation. Epic 003 ships the
// default/-z/-s/-f matrix on the tracked fixtures; Epic 004 will add
// -c / -d combos; Epic 006 wires the script to clone upstream at a
// pinned commit instead of relying on the sibling repo.

export const GOLDEN_COMBOS = [
  // Single-program default mode
  {
    name: 'hello-default',
    args: ['hello.ROM', 'hello.prg'],
    inputs: ['hello.prg'],
    output: 'hello-default.ROM',
    steem: false,
  },
  // Single-program default mode with -f3 (auto-launch at boot disk init)
  {
    name: 'hello-f3',
    args: ['-f3', 'hello-f3.ROM', 'hello.prg'],
    inputs: ['hello.prg'],
    output: 'hello-f3.ROM',
    steem: false,
  },
  // Single-program default mode + STEem prefix
  {
    name: 'hello-steem',
    args: ['-s', 'hello-steem.STC', 'hello.prg'],
    inputs: ['hello.prg'],
    output: 'hello-steem.STC',
    steem: true,
  },
  // Single-program with -z that auto-falls-back (hello is too small)
  {
    name: 'hello-z-fallback',
    args: ['-z', 'hello-z.ROM', 'hello.prg'],
    inputs: ['hello.prg'],
    output: 'hello-z-fallback.ROM',
    steem: false,
  },
  // Single-program with -z that actually compresses (synth.prg)
  {
    name: 'synth-z',
    args: ['-z', 'synth-z.ROM', 'synth.prg'],
    inputs: ['synth.prg'],
    output: 'synth-z.ROM',
    steem: false,
  },
  // Multi-program default mode (hello three times)
  {
    name: 'multi-default',
    args: ['multi.ROM', 'hello.prg', 'hello.prg', 'hello.prg'],
    inputs: ['hello.prg'],
    output: 'multi-default.ROM',
    steem: false,
  },
  // Multi-program mixed: default, compressed, default. -z after a file
  // applies to *that* file (the C tool's per-file flag semantics), so
  // synth.prg comes right before its -z to get compression.
  {
    name: 'multi-mixed',
    args: ['mixed.ROM', 'hello.prg', 'synth.prg', '-z', 'hello.prg'],
    inputs: ['hello.prg', 'synth.prg'],
    output: 'multi-mixed.ROM',
    steem: false,
  },
  // Classic mode, single program with two fixups (TEXT + BSS).
  {
    name: 'reloc-classic',
    args: ['-c', 'reloc.ROM', 'reloc.prg'],
    inputs: ['reloc.prg'],
    output: 'reloc-classic.ROM',
    steem: false,
  },
  // Classic mode with a custom BSS base address (-b40000).
  {
    name: 'reloc-classic-b40000',
    args: ['-c', '-b40000', 'reloc.ROM', 'reloc.prg'],
    inputs: ['reloc.prg'],
    output: 'reloc-classic-b40000.ROM',
    steem: false,
  },
  // Diagnostic mode (-d -c) on the same fixture.
  {
    name: 'reloc-diag',
    args: ['-d', '-c', 'diag.ROM', 'reloc.prg'],
    inputs: ['reloc.prg'],
    output: 'reloc-diag.ROM',
    steem: false,
  },
];
