USM-web
=======

Browser port of [USM](https://github.com/sidecartridge/atarist-USM) by @ggnkua — a tool that packages Atari ST `.PRG` / `.TOS` programs into 128 KB cartridge ROM images, usable in emulators (Hatari, STEem) or burned to real cart hardware.

Open `index.html` in a modern browser. No install, no server.

The output is held to **byte-for-byte parity** with the upstream C tool for the same inputs.

USM-web produces one of three cart layouts per program in the same cart:

| Mode                              | Option              | What ends up in ROM                                     | When to use                                              |
| --------------------------------- | ------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| Default                           | *(default)*         | A 236-byte stub loader + the verbatim PRG file          | The normal case — works for any well-formed PRG          |
| Default + LZSS compressed         | Compress checkbox   | A 304-byte LZSS stub + the LZSS-compressed PRG          | Larger or repetitive PRGs you want to squeeze in         |
| Classic                           | Classic mode toggle | TEXT + DATA only, relocated to ROM addresses            | Tiny position-independent programs / early-boot code     |

Multi-program carts (multiple PRGs chained via `CA_NEXT`) work in any mode and can freely mix compressed and uncompressed entries.

---

Using the app
-------------

1. Open `index.html` in Chrome / Firefox / Safari.
2. Drag and drop one or more `.PRG` or `.TOS` files onto Step 1, or use the file picker.
3. Step 2 — choose output format (`.ROM`, `.STC` for STEem, or Diagnostic), mode (Default or Classic), and per-program options (compress, init flag, BSS address for classic).
4. Step 3 — click Build. Watch the log pane for per-program compression results.
5. Step 4 — download the ROM.

To run the resulting cart in Hatari:

```sh
hatari --cartridge GAME.ROM
```

For STEem Engine, choose the `.STC` output format (it adds the 4-byte prefix STEem expects).

For real hardware, the [SidecarTridge Multidevice](https://sidecartridge.com/products/sidecartridge-multidevice-atari-st/) in ROM Emulation mode is the safe path — drop the `.ROM` onto its storage and the device presents it to the ST as if it were a real cart.

---

Caveats
-------

Same as upstream:

- Only single-file PRG programs. Programs that try to load external files at runtime will fail (the cart has no filesystem).
- Maximum input file size is 128 KB.
- Classic mode (`-c`) doesn't support PRG programs that access BSS via PC-relative addressing — use the default mode instead.

---

Developing
----------

Source of truth is `src/`. `index.html` is a generated, committed artifact.

```sh
npm ci                 # one-time install
npm run build          # src/ → index.html
npm test               # Vitest in node
npm run verify-goldens # diff cart-writer output vs tests/golden/*.ROM
```

See `AGENTS.md` for layout, prerequisites, and code-style notes. See `CLAUDE.md` for architecture details.

---

Thank yous
----------

[@ggnkua](https://github.com/ggnkua) for the original USM and for the 68k stub loader work. tIn / Newline for the original stub loader source.
