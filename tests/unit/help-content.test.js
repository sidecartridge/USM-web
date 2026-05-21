import { describe, it, expect } from 'vitest';
import { HELP_CONTENT, HELP_KEYS } from '../../src/help-content.js';

const EXPECTED_KEYS = [
  'add-programs',
  'init-flag',
  'compress',
  'output-format',
  'mode',
  'globals',
  'download',
];

describe('HELP_CONTENT', () => {
  it('exports the seven expected keys', () => {
    expect(HELP_KEYS.sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it.each(EXPECTED_KEYS)('entry %s has a non-empty title and html', (key) => {
    const entry = HELP_CONTENT[key];
    expect(entry).toBeDefined();
    expect(typeof entry.title).toBe('string');
    expect(entry.title.length).toBeGreaterThan(0);
    expect(typeof entry.html).toBe('string');
    expect(entry.html.length).toBeGreaterThan(20);
  });

  it('init-flag entry includes a table with the six valid -f values', () => {
    const html = HELP_CONTENT['init-flag'].html;
    expect(html).toMatch(/<table>/);
    for (const v of ['<code>0</code>', '<code>1</code>', '<code>3</code>', '<code>5</code>', '<code>6</code>', '<code>7</code>']) {
      expect(html).toContain(v);
    }
    // The skipped values (2 and 4) are deliberately not exposed.
    expect(html).not.toMatch(/<td><code>2<\/code><\/td>/);
    expect(html).not.toMatch(/<td><code>4<\/code><\/td>/);
  });
});
