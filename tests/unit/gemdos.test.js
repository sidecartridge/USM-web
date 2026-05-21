import { describe, it, expect } from 'vitest';
import { gemdosTimeDate, toEightThreeName } from '../../src/gemdos.js';

describe('gemdosTimeDate', () => {
  it('encodes 2024-01-15 13:45:30 UTC', () => {
    const { time, date } = gemdosTimeDate(new Date('2024-01-15T13:45:30Z'));
    // time = (13 << 11) | (45 << 5) | (30 / 2) = 0x6DAF
    // date = ((2024-1980) << 9) | (1 << 5) | 15 = (44 << 9) | 47 = 0x582F
    expect(time).toBe(0x6DAF);
    expect(date).toBe(0x582F);
  });

  it('encodes the 1980-01-01 epoch (zero point)', () => {
    const { time, date } = gemdosTimeDate(new Date('1980-01-01T00:00:00Z'));
    // time = 0, date = (0 << 9) | (1 << 5) | 1 = 0x21
    expect(time).toBe(0);
    expect(date).toBe(0x21);
  });

  it('rounds odd-second timestamps down (2-second granularity)', () => {
    const { time } = gemdosTimeDate(new Date('2024-01-15T13:45:31Z'));
    // (31 / 2) integer truncated to 15, same as the C `seconds / 2`.
    expect(time & 0x1F).toBe(15);
  });

  it('clamps years before 1980 to the zero point', () => {
    const { time, date } = gemdosTimeDate(new Date('1970-06-15T12:34:56Z'));
    expect(time).toBe(0);
    expect(date).toBe(0x21);
  });

  it('clamps years above 2107', () => {
    const { date } = gemdosTimeDate(new Date('2999-06-15T00:00:00Z'));
    // year clamped to 2107, month/day preserved: (127 << 9) | (6 << 5) | 15
    expect((date >> 9) & 0x7F).toBe(127);
  });

  it('returns the zero point for invalid input', () => {
    expect(gemdosTimeDate(null)).toEqual({ time: 0, date: 0x21 });
    expect(gemdosTimeDate(undefined)).toEqual({ time: 0, date: 0x21 });
    expect(gemdosTimeDate(new Date('not a date'))).toEqual({ time: 0, date: 0x21 });
  });
});

describe('toEightThreeName', () => {
  function decode(buf) {
    let s = '';
    for (let i = 0; i < buf.length && buf[i] !== 0; i++) {
      s += String.fromCharCode(buf[i]);
    }
    return s;
  }

  it('uppercases and pads a simple name', () => {
    const out = toEightThreeName('hello.prg');
    expect(decode(out)).toBe('HELLO.PRG');
    expect(out.length).toBe(14);
  });

  it('strips a Unix directory prefix', () => {
    expect(decode(toEightThreeName('/path/to/foo.prg'))).toBe('FOO.PRG');
  });

  it('strips a Windows directory prefix', () => {
    expect(decode(toEightThreeName('C:\\dir\\bar.tos'))).toBe('BAR.TOS');
  });

  it('truncates a long base to 8 characters', () => {
    expect(decode(toEightThreeName('LONGFILENAME.TOS'))).toBe('LONGFILE.TOS');
  });

  it('truncates a long extension to 3 characters', () => {
    expect(decode(toEightThreeName('foo.EXTRA'))).toBe('FOO.EXT');
  });

  it('handles names with multiple dots, first dot ends base', () => {
    expect(decode(toEightThreeName('a.b.c'))).toBe('A.B.C');
  });

  it('handles names with no extension', () => {
    expect(decode(toEightThreeName('noext'))).toBe('NOEXT');
  });

  it('handles a name ending in a bare dot', () => {
    expect(decode(toEightThreeName('FOO.'))).toBe('FOO.');
  });

  it('always returns a 14-byte buffer with trailing NULs', () => {
    const out = toEightThreeName('a.b');
    expect(out.length).toBe(14);
    // 'A', '.', 'B', then NULs through the end.
    expect(Array.from(out.slice(3))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
