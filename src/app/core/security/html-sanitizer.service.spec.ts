import { describe, expect, it } from 'vitest';
import { HtmlSanitizerService } from './html-sanitizer.service';

describe('HtmlSanitizerService', () => {
  const service = new HtmlSanitizerService();

  describe('sanitizeHtml()', () => {
    it('passes safe HTML through unchanged', () => {
      const result = service.sanitizeHtml('<p>Hello <strong>world</strong></p>');
      expect(result).toContain('Hello');
      expect(result).toContain('<strong>');
    });

    it('strips script tags and their content', () => {
      const result = service.sanitizeHtml('<p>safe</p><script>alert(1)</script>');
      expect(result).not.toContain('<script');
      expect(result).not.toContain('alert(1)');
      expect(result).toContain('safe');
    });

    it('strips event handler attributes', () => {
      const result = service.sanitizeHtml('<img src="x" onerror="alert(1)">');
      expect(result).not.toContain('onerror');
    });
  });

  describe('sanitizeToPlainText()', () => {
    it('extracts plain text from HTML', () => {
      expect(service.sanitizeToPlainText('<p>Hello <strong>world</strong></p>')).toBe(
        'Hello world'
      );
    });

    it('strips all tags leaving only text content', () => {
      const result = service.sanitizeToPlainText('<h1>Title</h1><p>Body</p>');
      expect(result).not.toContain('<');
      expect(result).toContain('Title');
      expect(result).toContain('Body');
    });

    it('strips script content before extracting text', () => {
      const result = service.sanitizeToPlainText('safe<script>evil()</script>');
      expect(result).toBe('safe');
    });

    it('returns an empty string for tag-only input', () => {
      expect(service.sanitizeToPlainText('<br><hr>')).toBe('');
    });
  });

  describe('sanitizeNotesOrNull()', () => {
    it('returns null for empty placeholder notes', () => {
      expect(service.sanitizeNotesOrNull('<p></p>')).toBeNull();
      expect(service.sanitizeNotesOrNull('<p><strong></strong></p>')).toBeNull();
    });

    it('preserves structure-only notes for supported rich-text nodes', () => {
      expect(service.sanitizeNotesOrNull('<ul><li><p></p></li></ul>')).toContain('<ul');
      expect(
        service.sanitizeNotesOrNull(
          '<details><summary><p></p></summary><div data-type="detailsContent"><p></p></div></details>'
        )
      ).toContain('<details');
      expect(service.sanitizeNotesOrNull('<hr>')).toContain('<hr');
    });

    it('removes unsafe markup while preserving content', () => {
      expect(service.sanitizeNotesOrNull('  hello<script>alert(1)</script>  ')).toBe('  hello  ');
    });

    it('returns null for non-string input', () => {
      expect(service.sanitizeNotesOrNull(null)).toBeNull();
      expect(service.sanitizeNotesOrNull(undefined)).toBeNull();
      expect(service.sanitizeNotesOrNull(42)).toBeNull();
    });

    it('normalizes CRLF and CR line endings to LF', () => {
      const result = service.sanitizeNotesOrNull('<p>line1\r\nline2\rline3</p>');
      expect(result).not.toContain('\r');
    });
  });

  it('returns null for non-string input to sanitizeNotesOrNull', () => {
    expect(service.sanitizeNotesOrNull(null)).toBeNull();
    expect(service.sanitizeNotesOrNull(undefined)).toBeNull();
    expect(service.sanitizeNotesOrNull(42)).toBeNull();
    expect(service.sanitizeNotesOrNull({})).toBeNull();
  });

  it('sanitizeHtml strips script tags', () => {
    const result = service.sanitizeHtml('<p>safe</p><script>bad()</script>');
    expect(result).toContain('<p>safe</p>');
    expect(result).not.toContain('<script>');
  });

  it('sanitizeToPlainText returns plain text content', () => {
    const result = service.sanitizeToPlainText('<p>Hello <strong>world</strong></p>');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).not.toContain('<p>');
  });

  it('sanitizeToPlainText returns empty string for empty input', () => {
    expect(service.sanitizeToPlainText('')).toBe('');
    expect(service.sanitizeToPlainText('<p></p>')).toBe('');
  });

  it('normalizes CRLF line endings in sanitizeNotesOrNull', () => {
    const result = service.sanitizeNotesOrNull('line1\r\nline2\rline3');
    expect(result).not.toBeNull();
    expect(result).toContain('line1');
    expect(result).toContain('line2');
    expect(result).toContain('line3');
  });
});
