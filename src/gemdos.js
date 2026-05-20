// GEMDOS time/date and 8.3 filename helpers — match
// atarist-USM/usm.c:152-178 and the inline filename loop at usm.c:716-744.

// GEMDOS time word: (hours << 11) | (minutes << 5) | (seconds / 2).
// GEMDOS date word: ((year - 1980) << 9) | (month << 5) | day.
//
// The C reference reads the file mtime via localtime(), so the resulting
// CA_TIME/CA_DATE depend on the host timezone. Goldens are generated
// with TZ=UTC so byte-parity tests are reproducible; for stability in
// JS we always read UTC fields from the Date argument. Production
// (browser) gets UTC timestamps regardless of the user's locale — a
// deliberate divergence from the C tool's localtime() behavior, in
// exchange for byte-stable output across hosts.
//
// Years outside [1980, 2107] are clamped (the C reference does the same
// at usm.c:173-174). When `date` is null/undefined or non-Date the
// caller gets the 1980-01-01 00:00:00 zero point — also matches the
// C fallback when stat() fails.
export function gemdosTimeDate(date) {
  let year, month, day, hour, minute, second;
  if (date instanceof Date && !Number.isNaN(date.valueOf())) {
    year   = date.getUTCFullYear();
    month  = date.getUTCMonth() + 1;
    day    = date.getUTCDate();
    hour   = date.getUTCHours();
    minute = date.getUTCMinutes();
    second = date.getUTCSeconds();
  } else {
    year = 1980; month = 1; day = 1; hour = 0; minute = 0; second = 0;
  }

  if (year < 1980) { year = 1980; month = 1; day = 1; hour = 0; minute = 0; second = 0; }
  if (year > 2107) { year = 2107; }

  const time = ((hour << 11) | (minute << 5) | (second >> 1)) & 0xffff;
  const dateWord = (((year - 1980) << 9) | (month << 5) | day) & 0xffff;
  return { time, date: dateWord };
}

// Convert any input path to the 14-byte CA_FILENAME slot's contents:
// uppercase, 8.3, NUL-padded. Matches the loop at usm.c:716-744.
// Returns a 14-byte Uint8Array. Behavior on edge cases:
//   - "/path/to/foo.prg" -> directory prefix stripped to "FOO.PRG".
//   - "LONGFILENAME.TOS" -> base truncated to 8 chars: "LONGFILE.TOS".
//   - "a.b.c"            -> base "A", then ".B.C" copied verbatim.
//   - "noext"            -> base "NOEXT" only; no dot, no extension.
//   - "FOO."             -> base "FOO" then "." (the C loop copies the
//                            dot even with no characters after it).
export function toEightThreeName(filename) {
  if (typeof filename !== 'string') {
    throw new Error('toEightThreeName: expected a string');
  }

  // Strip directory prefix (both '/' and '\\', matching usm.c:554-560).
  let s = filename;
  let lastSlash = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '/' || s[i] === '\\') lastSlash = i;
  }
  if (lastSlash >= 0) s = s.slice(lastSlash + 1);

  const out = new Uint8Array(14);  // pre-zeroed
  let dst = 0;
  let src = 0;

  // Copy up to 8 chars of the base, uppercase, stopping at '.' or EOS.
  for (let i = 0; i < 8; i++) {
    const c = s.charCodeAt(src);
    if (Number.isNaN(c) || c === 0x2E /* '.' */) break;
    out[dst++] = asciiUpper(c);
    src++;
  }

  // Skip any extra base characters that didn't fit (truncation).
  while (src < s.length && s.charCodeAt(src) !== 0x2E) src++;

  // Copy the dot + up to 3 extension chars, uppercase. The C loop runs
  // i<4 which is "1 dot + 3 chars".
  for (let i = 0; i < 4; i++) {
    if (src >= s.length) break;
    out[dst++] = asciiUpper(s.charCodeAt(src));
    src++;
  }

  return out;
}

function asciiUpper(code) {
  if (code >= 0x61 && code <= 0x7A) return code - 0x20;
  return code;
}
