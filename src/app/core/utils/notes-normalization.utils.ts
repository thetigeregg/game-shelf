const EMPTY_RICH_TEXT_PATTERN = /^(<p>(<br\/?>)?<\/p>)+$/;
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i;

export function normalizeNotesValue(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\r\n?/g, '\n');
  const compactLower = normalized.replace(/\s+/g, '').toLowerCase();

  if (
    compactLower.length === 0 ||
    EMPTY_RICH_TEXT_PATTERN.test(compactLower) ||
    isHtmlWithoutTextContent(normalized)
  ) {
    return '';
  }

  return normalized;
}

export function normalizeNotesValueOrNull(value: string | null | undefined): string | null {
  const normalized = normalizeNotesValue(value);
  return normalized.length > 0 ? normalized : null;
}

function isHtmlWithoutTextContent(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed.startsWith('<') || !HTML_TAG_PATTERN.test(trimmed)) {
    return false;
  }

  if (typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = trimmed;
    return (container.textContent || '').trim().length === 0;
  }

  return trimmed.replace(/<[^>]*>/g, '').trim().length === 0;
}
