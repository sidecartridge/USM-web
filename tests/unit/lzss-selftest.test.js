import { describe, it, expect } from 'vitest';
import { lzssSelftest } from '../../src/lzss.js';

describe('lzssSelftest', () => {
  it('passes when called explicitly', () => {
    // If the encoder/decoder pair were broken, the module import above
    // would already have thrown. This test exists to (a) document that
    // the export is part of the public API and (b) prove the selftest
    // function is idempotent on a fresh call.
    expect(() => lzssSelftest()).not.toThrow();
  });
});
