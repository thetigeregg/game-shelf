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
}
