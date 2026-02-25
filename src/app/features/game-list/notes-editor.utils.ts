export function normalizeEditorNotesValue(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\r\n?/g, '\n');
  const compact = normalized.replace(/\s+/g, '');

  if (
    compact.length === 0 ||
    compact === '<p></p>' ||
    compact === '<p><br></p>' ||
    compact === '<p></p><p></p>'
  ) {
    return '';
  }

  return normalized;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
