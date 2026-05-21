// USM-web UI. State machine driving the four-step accordion: add files,
// set options, build, download. The cart-writer engine in
// src/cart-writer.js does all the byte-level work; this file is glue
// between the DOM and that engine.

import { buildCart, DEFAULT_BSS_ADDR } from './cart-writer.js';
import { parsePrgHeader, PRG_MAX_FILE_SIZE } from './prg.js';
import { HELP_CONTENT } from './help-content.js';

const INIT_FLAG_OPTIONS = ['', '0', '1', '3', '5', '6', '7'];

// ----- pure helpers (exported for tests) -----

// Derive the suggested output filename from the first program's stem
// plus the extension implied by the output format.
export function defaultOutputName(firstProgramName, output) {
  const stem = (firstProgramName || 'cart').replace(/\.[^.]*$/, '');
  const ext = output === 'stc' ? '.STC' : '.ROM';
  return stem.toUpperCase() + ext;
}

// Format a log event from cart-writer's onLogLine into one line of
// console-style output. The compressed / fallback line shapes match
// the C tool's stdout; the program-start / header / layout / fixups
// / summary shapes are USM-web verbose extensions.
export function formatLogLine(event) {
  switch (event.type) {
    case 'program-start':
      return `==> [${event.index}/${event.total}] ${event.name}`;
    case 'header':
      return `      PRG header: tsize=${event.tsize} dsize=${event.dsize} bsize=${event.bsize} ssize=${event.ssize} prgflags=0x${event.prgflags.toString(16)} absflag=${event.absflag}`;
    case 'layout': {
      const payload = formatAddr(event.payloadAddr);
      const padded = event.paddedSize === event.payloadSize + (event.diagnostic ? 0 : 34)
        ? ''
        : `, padded to ${event.paddedSize}`;
      if (event.diagnostic) {
        return `      Layout: diagnostic mode, TEXT+DATA at ${payload} (${event.payloadSize} bytes, no CA_HEADER)${padded}`;
      }
      const header = formatAddr(event.caHeaderAddr);
      const label = event.mode === 'classic'
        ? 'classic mode, TEXT+DATA'
        : event.mode === 'compressed'
          ? 'compressed mode, stub + size + payload'
          : 'default mode, stub + PRG';
      return `      Layout: ${label}. CA_HEADER at ${header}, payload at ${payload} (${event.payloadSize} bytes)${padded}`;
    }
    case 'fixups':
      if (event.count === 0) {
        return `      Relocations: none (program has ABSFLAG set or empty reloc table)`;
      }
      return `      Relocations: ${event.count} fixup${event.count === 1 ? '' : 's'} applied (BSS base ${formatAddr(event.bssAddr)})`;
    case 'compressed':
      return `      + ${event.name}: compressed ${event.origSize} -> ${event.compSize} (${event.dataRatio.toFixed(1)}%)`;
    case 'fallback':
      return `      + ${event.name}: no savings (${event.entryRatio.toFixed(0)}% entry), shipping uncompressed`;
    case 'summary': {
      const prog = `${event.programCount} program${event.programCount === 1 ? '' : 's'}`;
      const fill = `${event.usmFillBytes} bytes USM!-fill remaining`;
      const steem = event.steem ? ' (.STC: 4-byte prefix + 128 KB cart)' : '';
      return `==> Cart ready: ${event.totalBytes} bytes, ${prog}, ${fill}${steem}`;
    }
    default:
      return `      + ${event.name ?? '(event)'}`;
  }
}

function formatAddr(n) {
  return '$' + (n >>> 0).toString(16).toUpperCase().padStart(6, '0');
}

// Parse a hex BSS address (e.g. "20000" -> 0x20000). Returns null on
// any input that isn't 1..8 hex chars.
export function parseHexAddress(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!/^[0-9A-Fa-f]{1,8}$/.test(t)) return null;
  return parseInt(t, 16);
}

// Format file size in a short human-readable way.
export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

// Render a ? help icon that opens the modal keyed on `key`. Used both
// from static template positions and from per-row table headers.
export function helpIconHtml(key) {
  const entry = HELP_CONTENT[key];
  const label = entry ? entry.title : key;
  return `<button type="button" class="help-icon" data-help-key="${key}" aria-label="Help: ${escapeAttr(label)}" title="${escapeAttr(label)}">?</button>`;
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ----- DOM bootstrap (skipped if `document` isn't available, e.g. in
// node-only tests).
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initUi);
}

function initUi() {
  if (!featureCheck()) return;

  const state = {
    programs: [],          // { id, file, name, bytes, header, compress, initFlag, bssAddr, error }
    nextId: 1,
    output: 'rom',         // 'rom' | 'stc' | 'diag'
    mode: 'default',       // 'default' | 'classic'
    globalCompress: false,
    globalInitFlag: '',    // '' | '0' .. '7'
    globalBssAddr: '20000',
    builtCart: null,       // Uint8Array
    blobUrl: null,         // for revoke()
  };

  wireStep1(state);
  wireStep2(state);
  wireStep3(state);
  wireStep4(state);
  wireLogToggle();
  wireHelpModal();
  refreshAll(state);
}

// ----- help modal -----

function wireHelpModal() {
  const dialog = document.getElementById('helpModal');
  if (!dialog) return;
  const closeBtn = dialog.querySelector('.modal-close');
  closeBtn.addEventListener('click', () => dialog.close());
  // Backdrop click: when the user clicks the dialog at coordinates
  // outside the visible panel, the event's target is the <dialog>
  // itself (not a child). Compare directly to identify that case.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  // ESC-to-close is built into <dialog>; nothing extra to wire.

  // Delegated click for every ? icon, regardless of where the icon
  // lives (header, fieldset legend, table header, per-row, future).
  const app = document.getElementById('app');
  app.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.help-icon[data-help-key]');
    if (!btn) return;
    openHelp(btn.dataset.helpKey);
  });
}

function openHelp(key) {
  const entry = HELP_CONTENT[key];
  if (!entry) {
    console.warn(`openHelp: no entry for key "${key}"`);
    return;
  }
  document.getElementById('helpModalTitle').textContent = entry.title;
  document.getElementById('helpModalBody').innerHTML = entry.html;
  const dialog = document.getElementById('helpModal');
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    // Very old browsers: fall back to setting the [open] attribute.
    dialog.setAttribute('open', '');
  }
}

// ----- feature detection -----

function featureCheck() {
  const ok =
    typeof File !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function';
  if (!ok) {
    const w = document.getElementById('browserWarning');
    if (w) w.style.display = 'block';
    const inp = document.getElementById('fileInput');
    if (inp) inp.disabled = true;
    return false;
  }
  return true;
}

// ----- Step 1: file picker + drag-drop + file list -----

function wireStep1(state) {
  const drop = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');

  input.addEventListener('change', () => {
    addFiles(state, Array.from(input.files));
    input.value = '';  // allow re-selecting the same file
  });

  drop.addEventListener('dragenter', (e) => { e.preventDefault(); drop.classList.add('drag-active'); });
  drop.addEventListener('dragover',  (e) => { e.preventDefault(); drop.classList.add('drag-active'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-active'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag-active');
    if (e.dataTransfer && e.dataTransfer.files) {
      addFiles(state, Array.from(e.dataTransfer.files));
    }
  });
}

async function addFiles(state, files) {
  for (const file of files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const entry = {
      id: state.nextId++,
      file,
      name: file.name,
      bytes: buf,
      header: null,
      compress: state.globalCompress,
      initFlag: state.globalInitFlag,
      bssAddr: state.globalBssAddr,
      error: null,
    };
    try {
      if (buf.length > PRG_MAX_FILE_SIZE) {
        throw new Error(`file is ${buf.length} bytes, exceeds 128 KB`);
      }
      entry.header = parsePrgHeader(buf);
    } catch (err) {
      entry.error = err.message;
    }
    state.programs.push(entry);
  }
  invalidateBuild(state);
  refreshAll(state);
}

function removeProgram(state, id) {
  state.programs = state.programs.filter((p) => p.id !== id);
  invalidateBuild(state);
  refreshAll(state);
}

function moveProgram(state, id, delta) {
  const i = state.programs.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.programs.length) return;
  const arr = state.programs;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  invalidateBuild(state);
  refreshAll(state);
}

function renderFileList(state) {
  const table = document.getElementById('fileList');
  const tbody = table.querySelector('tbody');
  const hint = document.getElementById('step1Hint');

  if (state.programs.length === 0) {
    table.style.display = 'none';
    hint.textContent = 'No programs yet.';
    return;
  }
  hint.textContent = `${state.programs.length} program${state.programs.length === 1 ? '' : 's'} ready.`;
  table.style.display = '';

  // Show BSS column only in classic mode.
  const bssTh = table.querySelector('th.bss-col');
  bssTh.style.display = state.mode === 'classic' ? '' : 'none';

  tbody.innerHTML = '';
  state.programs.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(p.name)}${p.error ? `<div class="row-error">${escapeHtml(p.error)}</div>` : ''}</td>
      <td>${formatSize(p.bytes.length)}</td>
      <td><input type="checkbox" class="prog-compress" ${p.compress ? 'checked' : ''}></td>
      <td>${initFlagSelectHtml(p.initFlag)}</td>
      <td class="bss-col" style="display:${state.mode === 'classic' ? '' : 'none'}">
        <input type="text" class="prog-bss" value="${escapeHtml(p.bssAddr)}" size="8">
      </td>
      <td class="actions">
        <button class="move-up" type="button" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="move-down" type="button" ${i === state.programs.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="remove" type="button">Remove</button>
      </td>
    `;
    tr.querySelector('.prog-compress').addEventListener('change', (e) => {
      p.compress = e.target.checked;
      invalidateBuild(state);
      refreshAll(state);
    });
    tr.querySelector('.prog-initFlag').addEventListener('change', (e) => {
      p.initFlag = e.target.value;
      invalidateBuild(state);
      refreshAll(state);
    });
    tr.querySelector('.prog-bss').addEventListener('change', (e) => {
      p.bssAddr = e.target.value;
      invalidateBuild(state);
      refreshAll(state);
    });
    tr.querySelector('.move-up').addEventListener('click', () => moveProgram(state, p.id, -1));
    tr.querySelector('.move-down').addEventListener('click', () => moveProgram(state, p.id, +1));
    tr.querySelector('.remove').addEventListener('click', () => removeProgram(state, p.id));
    tbody.appendChild(tr);
  });
}

function initFlagSelectHtml(current) {
  const opts = INIT_FLAG_OPTIONS.map((v) => {
    const sel = v === current ? ' selected' : '';
    const label = v === '' ? '(none)' : `-f${v}`;
    return `<option value="${v}"${sel}>${label}</option>`;
  }).join('');
  return `<select class="prog-initFlag">${opts}</select>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ----- Step 2: cart options + validation -----

function wireStep2(state) {
  for (const r of document.querySelectorAll('input[name="output"]')) {
    r.addEventListener('change', () => {
      state.output = r.value;
      // Diagnostic output implies classic mode; the C tool enforces this
      // at usm.c:613-621 too.
      if (state.output === 'diag') state.mode = 'classic';
      reflectModeToDom(state);
      invalidateBuild(state);
      refreshAll(state);
    });
  }
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.addEventListener('change', () => {
      state.mode = r.value;
      // Switching out of classic clears diagnostic output (incompatible).
      if (state.mode !== 'classic' && state.output === 'diag') state.output = 'rom';
      reflectModeToDom(state);
      invalidateBuild(state);
      refreshAll(state);
    });
  }
  // The three "defaults for newly added programs" controls only affect
  // FUTURE files (not the existing list). Their change doesn't
  // invalidate the current build's bytes.
  document.getElementById('globalCompress').addEventListener('change', (e) => {
    state.globalCompress = e.target.checked;
  });
  document.getElementById('globalInitFlag').addEventListener('change', (e) => {
    state.globalInitFlag = e.target.value;
  });
  document.getElementById('globalBssAddr').addEventListener('change', (e) => {
    state.globalBssAddr = e.target.value;
    refreshAll(state);
  });
}

function reflectModeToDom(state) {
  // Sync the output and mode radios with state (in case we changed them
  // programmatically via the diagnostic <-> classic coupling above).
  for (const r of document.querySelectorAll('input[name="output"]')) {
    r.checked = r.value === state.output;
  }
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.checked = r.value === state.mode;
  }
  // Show / hide the global BSS field and the per-row BSS column.
  for (const el of document.querySelectorAll('.classic-only')) {
    el.style.display = state.mode === 'classic' ? '' : 'none';
  }
}

// Compute per-program resolved options + the (classic, diagnostic) flags
// + a list of human-readable errors. Used by both the inline validation
// banner (Step 2) and the actual build call (Step 3).
function resolveCartOptions(state) {
  const errors = [];
  const classic = state.mode === 'classic';
  const diagnostic = state.output === 'diag';
  const steem = state.output === 'stc';

  if (state.programs.length === 0) {
    errors.push('Add at least one program in Step 1.');
  }
  for (const p of state.programs) {
    if (p.error) errors.push(`${p.name}: ${p.error}`);
  }
  if (diagnostic && state.programs.length > 1) {
    errors.push('Diagnostic carts must contain exactly one program (drop the extras or pick a different output format).');
  }

  const globalBss = parseHexAddress(state.globalBssAddr);
  if (classic && globalBss === null) {
    errors.push(`Global BSS address "${state.globalBssAddr}" is not valid hex.`);
  }
  for (const p of state.programs) {
    if (classic) {
      if (parseHexAddress(p.bssAddr) === null) {
        errors.push(`${p.name}: BSS address "${p.bssAddr}" is not valid hex.`);
      }
    }
    if (diagnostic && p.compress) {
      errors.push(`${p.name}: -z (compress) is incompatible with diagnostic carts.`);
    }
    if (classic && p.compress) {
      errors.push(`${p.name}: -z (compress) is incompatible with classic mode.`);
    }
  }

  const resolvedPrograms = state.programs.map((p) => ({
    name: p.name,
    bytes: p.bytes,
    compress: classic || diagnostic ? false : p.compress,
    initFlagDigit: p.initFlag === '' ? null : parseInt(p.initFlag, 10),
    bssAddr: classic ? (parseHexAddress(p.bssAddr) ?? globalBss ?? DEFAULT_BSS_ADDR) : undefined,
    mtime: new Date(p.file.lastModified),
  }));

  return { errors, classic, diagnostic, steem, globalBssAddr: globalBss ?? DEFAULT_BSS_ADDR, resolvedPrograms };
}

function renderStep2Errors(state) {
  const banner = document.getElementById('step2Errors');
  const { errors } = resolveCartOptions(state);
  if (errors.length === 0) {
    banner.style.display = 'none';
    banner.textContent = '';
    return;
  }
  banner.style.display = '';
  banner.innerHTML = '<strong>Resolve before building:</strong><ul style="margin:6px 0 0;padding-left:20px;">' +
    errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
}

// ----- Step 3: build -----

function wireStep3(state) {
  document.getElementById('buildBtn').addEventListener('click', () => doBuild(state));
}

function doBuild(state) {
  const { errors, classic, diagnostic, steem, globalBssAddr, resolvedPrograms } = resolveCartOptions(state);
  if (errors.length > 0) return; // step gating shouldn't allow this, but be safe

  clearLog();
  setProgress(0);

  // Progress ticks once per program-start event so the bar advances at
  // the start of each entry (not at the end). With one program that
  // jumps 0 -> 100 immediately, which is fine; with N programs the
  // bar steps 1/N at a time.
  let done = 0;
  try {
    state.builtCart = buildCart({
      programs: resolvedPrograms,
      steem,
      classic,
      diagnostic,
      globalBssAddr,
      onLogLine: (event) => {
        appendLogLine(formatLogLine(event));
        if (event.type === 'program-start') {
          done++;
          setProgress(Math.round((done / resolvedPrograms.length) * 100));
        }
      },
    });
    setProgress(100);
  } catch (err) {
    appendLogLine(`!! Build failed: ${err.message}`);
    state.builtCart = null;
    refreshAll(state);
    return;
  }

  setupDownload(state);
  refreshAll(state);
}

function clearLog() {
  document.getElementById('log').textContent = '';
}

function appendLogLine(text) {
  const log = document.getElementById('log');
  log.textContent += (log.textContent ? '\n' : '') + text;
  log.scrollTop = log.scrollHeight;
}

function setProgress(pct) {
  document.getElementById('prog').value = pct;
  document.getElementById('progLabel').textContent = `${pct}%`;
}

// ----- Step 4: download + reset -----

function wireStep4(state) {
  document.getElementById('outputName').addEventListener('change', (e) => {
    document.getElementById('downloadLink').download = e.target.value;
  });
  document.getElementById('resetBtn').addEventListener('click', () => resetState(state));
}

function setupDownload(state) {
  const first = state.programs[0];
  const name = defaultOutputName(first ? first.name : 'cart', state.output);
  const link = document.getElementById('downloadLink');
  const nameInput = document.getElementById('outputName');
  nameInput.value = name;
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  state.blobUrl = URL.createObjectURL(new Blob([state.builtCart], { type: 'application/octet-stream' }));
  link.href = state.blobUrl;
  link.download = name;
  link.style.display = '';
  document.getElementById('fileName').textContent = `Cart: ${name} (${state.builtCart.length} bytes)`;
}

function resetState(state) {
  if (state.blobUrl) {
    URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = null;
  }
  state.programs = [];
  state.builtCart = null;
  document.getElementById('outputName').value = '';
  document.getElementById('downloadLink').style.display = 'none';
  document.getElementById('fileName').textContent = 'Cart: (no build yet)';
  setProgress(0);
  clearLog();
  refreshAll(state);
}

// ----- log pane toggle -----

function wireLogToggle() {
  const btn = document.getElementById('toggleLog');
  const log = document.getElementById('log');
  btn.addEventListener('click', () => {
    const showing = log.style.display !== 'none';
    log.style.display = showing ? 'none' : '';
    btn.textContent = showing ? 'Show process output' : 'Hide process output';
  });
}

// ----- step gating + visual state -----

// Any user-initiated change to programs or options invalidates the
// previous build: the byte output would differ now. Clears the built
// cart, revokes the blob URL, hides the download link, and resets the
// summary line so the user can't accidentally download stale bytes.
// Called by every mutator (addFiles, removeProgram, moveProgram, option
// changes); NOT called from doBuild itself.
function invalidateBuild(state) {
  if (state.builtCart == null) return;
  state.builtCart = null;
  if (state.blobUrl) {
    URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = null;
  }
  const link = document.getElementById('downloadLink');
  if (link) link.style.display = 'none';
  const fileName = document.getElementById('fileName');
  if (fileName) fileName.textContent = 'Cart: (no build yet)';
  setProgress(0);
}

function refreshAll(state) {
  renderFileList(state);
  renderStep2Errors(state);
  updateGating(state);
}

function updateGating(state) {
  const { errors } = resolveCartOptions(state);
  const hasFiles = state.programs.length > 0;
  const valid = hasFiles && errors.length === 0;
  const built = state.builtCart != null;

  setStep('step1', hasFiles ? 'complete' : 'active');
  setStep('step2', !hasFiles ? 'pending' : (valid ? 'complete' : 'active'));
  setStep('step3', !valid ? 'pending' : (built ? 'complete' : 'active'));
  setStep('step4', !built ? 'pending' : 'active');

  document.getElementById('buildBtn').disabled = !valid || built;
}

function setStep(id, mode) {
  const li = document.getElementById(id);
  if (!li) return;
  li.classList.remove('active', 'complete');
  if (mode === 'active' || mode === 'complete') li.classList.add(mode);
  const status = li.querySelector('.step-status');
  if (status) {
    status.textContent =
      mode === 'active'   ? 'Ready' :
      mode === 'complete' ? 'Done'  :
                            'Pending';
  }
}
