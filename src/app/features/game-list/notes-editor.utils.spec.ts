import { describe, expect, it } from 'vitest';
import {
  normalizeEditorNotesComparable,
  normalizeEditorNotesValue,
  toNotesEditorContent
} from './notes-editor.utils';

describe('notes-editor utils', () => {
  it('normalizes CRLF to LF without trimming user whitespace', () => {
    expect(normalizeEditorNotesValue('  line 1\r\nline 2  ')).toBe('  line 1\nline 2  ');
  });

  it('returns empty string for non-string note values', () => {
    expect(normalizeEditorNotesValue(undefined)).toBe('');
    expect(normalizeEditorNotesValue(null)).toBe('');
  });

  it('normalizes tiptap empty placeholders to empty string', () => {
    expect(normalizeEditorNotesValue('<p><br></p>')).toBe('');
    expect(normalizeEditorNotesValue('<p><br/></p>')).toBe('');
    expect(normalizeEditorNotesValue('   <p></p>   ')).toBe('');
    expect(normalizeEditorNotesValue('<p></p><p></p>')).toBe('');
  });

  it('treats plain text containing angle brackets as plain text', () => {
    expect(toNotesEditorContent('1 < 2')).toBe('<p>1 &lt; 2</p>');
  });

  it('converts plain-text line breaks to html breaks', () => {
    expect(toNotesEditorContent('Line 1\nLine 2')).toBe('<p>Line 1<br>Line 2</p>');
  });

  it('preserves existing html notes payloads', () => {
    expect(toNotesEditorContent('<p><strong>Boss notes</strong></p>')).toBe(
      '<p><strong>Boss notes</strong></p>'
    );
  });

  it('normalizes trailing empty block placeholders for notes comparisons', () => {
    expect(normalizeEditorNotesComparable('<ul><li>Item</li></ul><p></p>')).toBe(
      '<ul><li>Item</li></ul>'
    );
    expect(
      normalizeEditorNotesComparable(
        '<details><summary>Title</summary><div>Body</div></details><p><br></p>'
      )
    ).toBe('<details><summary>Title</summary><div>Body</div></details>');
    expect(normalizeEditorNotesComparable('<p>Content</p><p></p><p></p>')).toBe('<p>Content</p>');
    expect(normalizeEditorNotesComparable('<p>Content</p><div></div><p><br></p>')).toBe(
      '<p>Content</p>'
    );
    expect(normalizeEditorNotesComparable('<p>Content</p><p>   </p>')).toBe('<p>Content</p>');
    expect(normalizeEditorNotesComparable('<p>Content</p><p>&nbsp;</p>')).toBe('<p>Content</p>');
    expect(normalizeEditorNotesComparable('<p>Content</p><p><br></p>')).toBe('<p>Content</p>');
    expect(normalizeEditorNotesComparable('<p>Content </p><p></p>')).toBe('<p>Content </p>');
  });

  it('returns empty paragraph for empty normalized content', () => {
    expect(toNotesEditorContent('   ')).toBe('<p></p>');
  });
});
