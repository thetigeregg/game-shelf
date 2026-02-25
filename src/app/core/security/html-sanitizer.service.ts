import { Injectable } from '@angular/core';
import DOMPurify from 'dompurify';

@Injectable({ providedIn: 'root' })
export class HtmlSanitizerService {
  sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true }
    });
  }

  sanitizeToPlainText(html: string): string {
    const clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: []
    });

    const div = document.createElement('div');
    div.innerHTML = clean;

    return div.textContent ?? '';
  }
}
