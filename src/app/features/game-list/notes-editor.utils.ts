export function normalizeEditorNotesValue(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\r\n?/g, '\n');
  const compactLower = normalized.replace(/\s+/g, '').toLowerCase();

  if (
    compactLower.length === 0 ||
    compactLower === '<p></p>' ||
    compactLower === '<p><br></p>' ||
    compactLower === '<p><br/></p>' ||
    compactLower === '<p></p><p></p>'
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
