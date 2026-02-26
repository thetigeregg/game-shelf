const EMPTY_RICH_TEXT_PATTERN = /^(<p>(<br\/?>)?<\/p>)+$/;

export function normalizeNotesValue(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\r\n?/g, '\n');
  const compactLower = normalized.replace(/\s+/g, '').toLowerCase();

  if (compactLower.length === 0 || EMPTY_RICH_TEXT_PATTERN.test(compactLower)) {
    return '';
  }

  return normalized;
}

export function normalizeNotesValueOrNull(value: string | null | undefined): string | null {
  const normalized = normalizeNotesValue(value);
  return normalized.length > 0 ? normalized : null;
}
