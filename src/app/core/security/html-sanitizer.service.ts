import { Injectable } from '@angular/core';
import domPurify from 'dompurify';

@Injectable({ providedIn: 'root' })
export class HtmlSanitizerService {
  sanitizeHtml(html: string): string {
    return domPurify.sanitize(html, {
      USE_PROFILES: { html: true }
    });
  }

  sanitizeToPlainText(html: string): string {
    const clean = domPurify.sanitize(html, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: []
    });

    const div = document.createElement('div');
    div.innerHTML = clean;

    return div.textContent || '';
  }

  sanitizeNotesOrNull(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.replace(/\r\n?/g, '\n');
    const safeHtml = this.sanitizeHtml(normalized);
    const plainText = this.sanitizeToPlainText(safeHtml).trim();
    return plainText.length > 0 ? safeHtml : null;
  }
}
