import { normalizeNotesValue } from '../../core/utils/notes-normalization.utils';

export function normalizeEditorNotesValue(value: string | null | undefined): string {
  return normalizeNotesValue(value);
}

export function toNotesEditorContent(value: string): string {
  const normalized = normalizeEditorNotesValue(value);

  if (normalized.length === 0) {
    return '<p></p>';
  }

  if (isLikelyHtmlContent(normalized)) {
    return normalized;
  }

  return `<p>${escapeHtml(normalized).replace(/\n/g, '<br>')}</p>`;
}

function isLikelyHtmlContent(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('<') && /<\/?[a-z][^>]*>/i.test(trimmed);
}

// Escapes raw plain text before wrapping it in editor HTML; sanitization is handled on persistence.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
