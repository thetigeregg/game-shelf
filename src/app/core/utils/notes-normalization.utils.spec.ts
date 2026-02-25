import { describe, expect, it } from 'vitest';
import { normalizeNotesValue, normalizeNotesValueOrNull } from './notes-normalization.utils';

describe('notes-normalization utils', () => {
  it('normalizes CRLF line endings to LF', () => {
    expect(normalizeNotesValue('line 1\r\nline 2\rline 3')).toBe('line 1\nline 2\nline 3');
  });

  it('returns empty for nullish and non-string values', () => {
    expect(normalizeNotesValue(undefined)).toBe('');
    expect(normalizeNotesValue(null)).toBe('');
  });

  it('treats empty and placeholder html as empty', () => {
    expect(normalizeNotesValue('')).toBe('');
    expect(normalizeNotesValue('   ')).toBe('');
    expect(normalizeNotesValue('<p></p>')).toBe('');
    expect(normalizeNotesValue('<p><br></p>')).toBe('');
    expect(normalizeNotesValue('<p><br/></p>')).toBe('');
    expect(normalizeNotesValue('<p></p><p></p>')).toBe('');
  });

  it('preserves meaningful whitespace for non-empty content', () => {
    expect(normalizeNotesValue('  keep me  ')).toBe('  keep me  ');
  });

  it('returns null-or-string variant consistently', () => {
    expect(normalizeNotesValueOrNull(undefined)).toBeNull();
    expect(normalizeNotesValueOrNull('   ')).toBeNull();
    expect(normalizeNotesValueOrNull('<p><br></p>')).toBeNull();
    expect(normalizeNotesValueOrNull('notes')).toBe('notes');
  });
});
