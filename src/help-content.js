// Help-content data model. Each entry is referenced by slug from the
// `?` icons rendered throughout the page; clicking an icon opens the
// modal with the matching title + html body. Keys match the
// `data-help-key` attributes the icons carry.
//
// The `html` strings land in the modal via innerHTML; they are
// author-controlled (no user input) and should stay that way.

export const HELP_CONTENT = {
  'add-programs': {
    title: 'Step 1. Add programs',
    html: `
      <p>Drop one or more Atari ST executables (<code>.PRG</code> or <code>.TOS</code>) onto the box, or click <em>browse</em>. The files are read into the browser and never leave your machine, the whole cart is assembled client-side.</p>
      <h4>Limitations</h4>
      <ul>
        <li><strong>Each file must be a valid PRG.</strong> The header is checked on intake (magic <code>0x601A</code>); anything else is flagged inline on its row.</li>
        <li><strong>Maximum 128 KB per file.</strong> The cart itself is 128 KB; anything larger physically can't fit, even as the only entry.</li>
        <li><strong>Single-file programs only.</strong> Programs that try to load companion files at runtime will fail because the cart has no filesystem.</li>
        <li><strong>Multi-program carts</strong> are supported in every mode. The order in the list becomes the order on the cart's <code>c:</code> drive in TOS.</li>
      </ul>
    `,
  },

  'init-flag': {
    title: 'Init flag (-f)',
    html: `
      <p>Tells TOS when (or whether) to auto-run this program after a system reset. When <em>none</em> is selected, <code>CA_INIT</code> is written as zero and the program shows up on the cart's <code>c:</code> drive, the user double-clicks it to launch.</p>
      <table>
        <thead><tr><th><code>-fY</code></th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>0</code></td><td>Execute prior to display memory and interrupt-vector initialization.</td></tr>
          <tr><td><code>1</code></td><td>Execute just before GEMDOS is initialized.</td></tr>
          <tr><td><code>3</code></td><td>Execute prior to boot disk. Common for custom launchers.</td></tr>
          <tr><td><code>5</code></td><td>Application is a Desk Accessory.</td></tr>
          <tr><td><code>6</code></td><td>Application is not a GEM application.</td></tr>
          <tr><td><code>7</code></td><td>Application needs parameters.</td></tr>
        </tbody>
      </table>
      <p class="hint">Values 2 and 4 are intentionally not exposed, they map to unused bits in the underlying byte.</p>
    `,
  },

  'compress': {
    title: 'Compress (-z)',
    html: `
      <p>Asks USM to LZSS-12-4 compress this program's bytes before writing it to the cart. A small 304-byte decompressor stub is embedded next to the payload and runs at launch.</p>
      <p><strong>Auto-fallback.</strong> Compression isn't always a win, already-packed programs and small inputs typically grow. If the compressed entry (304-byte stub + 4-byte size + LZSS bytes) is larger than the uncompressed entry (236-byte stub + raw PRG), USM silently ships the uncompressed version. The build log shows which one was chosen.</p>
      <p>Empirical ratios on real-world programs range from 73% (text-heavy) to 110% (already packed). For tiny PRGs like a 88-byte hello-world, the larger compressed stub almost always loses.</p>
      <p class="hint">Per-file checkbox overrides the per-cart default in Step 2. <code>-z</code> is incompatible with Classic mode and with Diagnostic carts (both refuse to run the decompressor).</p>
    `,
  },

  'output-format': {
    title: 'Output format',
    html: `
      <p>The container the cart bytes are wrapped in.</p>
      <table>
        <thead><tr><th>Format</th><th>What you get</th></tr></thead>
        <tbody>
          <tr><td><code>.ROM</code></td><td>A plain 128 KB cart image. Works in Hatari (<code>--cartridge GAME.ROM</code>) and on real cart hardware. The default.</td></tr>
          <tr><td><code>.STC</code> (<code>-s</code>)</td><td>Same 128 KB cart with a 4-byte zero prefix prepended. STEem Engine expects this layout; load via STEem's cartridge insertion dialog.</td></tr>
          <tr><td>Diagnostic (<code>-d</code>)</td><td>The OS jumps straight to <code>$FA0004</code> after a reset, skipping the cart's normal header chain. The cart magic flips to <code>0xfa52235f</code>. Requires Classic mode and a single program. Used for boot-time utilities that run before GEMDOS exists.</td></tr>
        </tbody>
      </table>
    `,
  },

  'mode': {
    title: 'Mode',
    html: `
      <p>How each program is packed into the cart.</p>
      <h4>Default, stub loader</h4>
      <p>A 236-byte 68k stub is embedded alongside the verbatim PRG. At launch the stub asks TOS for a fresh TPA, builds a Pexec-style basepage, copies the PRG into RAM, applies relocations, zero-fills BSS, and jumps to the program. Works for any well-formed PRG.</p>
      <h4>Classic (<code>-c</code>), in-ROM</h4>
      <p>No stub. The program's TEXT+DATA are written directly to ROM with all absolute addresses pre-relocated to the cart's mapped range (<code>0xFA0000</code>+). BSS lives at a fixed RAM address (the <code>-b</code> field, default <code>0x20000</code>). The program runs in place from ROM.</p>
      <p>Classic mode only works reliably for position-independent or absolute-address programs that don't access BSS via PC-relative addressing. The relocation table can't signal those references, so the cart-build pass can't rewrite them. For full applications, use Default mode.</p>
    `,
  },

  'globals': {
    title: 'Defaults for newly added programs',
    html: `
      <p>The values that get applied to the next file you drop. Each per-file row can override its own flags after the fact; these defaults just save you clicking through every row when you've decided on a uniform setting.</p>
      <ul>
        <li><strong>Compress (<code>-z</code>)</strong>, turns on per-file compression for every file added <em>after</em> this checkbox flips. Existing files keep their current setting.</li>
        <li><strong>Init flag (<code>-f</code>)</strong>, the auto-run flag the next file will inherit. Same as the per-file init flag in scope, just pre-set.</li>
        <li><strong>BSS address (<code>-b</code>)</strong>, only visible in Classic mode. Hex address where BSS lives in RAM. Default <code>0x20000</code>.</li>
      </ul>
      <p class="hint">These are pre-fill values for the per-file controls. Editing a per-file row never changes the defaults.</p>
    `,
  },

  'download': {
    title: 'Step 4. Download',
    html: `
      <p>The build produced a complete 128 KB cart in memory (132 KB with the STEem prefix). Click <strong>Download</strong> to save it to disk. The default filename is the first program's stem plus <code>.ROM</code> or <code>.STC</code> depending on Output format; edit the field if you want a different name.</p>
      <h4>What's in the file</h4>
      <ul>
        <li><code>.ROM</code>, 128 KB cart image. Drop into Hatari with <code>--cartridge FILE.ROM</code> or into a SidecarTridge Multidevice's storage for real hardware.</li>
        <li><code>.STC</code>, same cart, 4-byte zero prefix. Load via STEem Engine's cartridge dialog.</li>
        <li>Diagnostic cart, also <code>.ROM</code> by extension, but with the diagnostic magic so the OS executes it on reset rather than mounting it as a drive.</li>
      </ul>
      <h4>Build another</h4>
      <p>Clears the file list, resets every step to its initial state, revokes the previous download's blob URL, and jumps back to Step 1. Use it when you want to start a fresh cart without reloading the page.</p>
    `,
  },
};

export const HELP_KEYS = Object.keys(HELP_CONTENT);
