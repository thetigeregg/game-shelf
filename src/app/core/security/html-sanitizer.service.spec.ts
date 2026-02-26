import { describe, expect, it } from 'vitest';
import { HtmlSanitizerService } from './html-sanitizer.service';

describe('HtmlSanitizerService', () => {
  const service = new HtmlSanitizerService();

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
});
