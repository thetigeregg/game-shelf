const EMPTY_RICH_TEXT_PATTERN = /^(<p>(<br\/?>)?<\/p>)+$/;
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i;
const MEANINGFUL_STRUCTURE_SELECTOR =
  'ul,ol,li,details,summary,hr,blockquote,pre,table,thead,tbody,tr,th,td,img,video,audio,iframe';
const MEANINGFUL_STRUCTURE_TAG_PATTERN =
  /<(ul|ol|li|details|summary|hr|blockquote|pre|table|thead|tbody|tr|th|td|img|video|audio|iframe)\b/i;

export function normalizeNotesValue(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\r\n?/g, '\n');
  const compactLower = normalized.replace(/\s+/g, '').toLowerCase();

  if (
    compactLower.length === 0 ||
    EMPTY_RICH_TEXT_PATTERN.test(compactLower) ||
    isHtmlWithoutMeaningfulContent(normalized)
  ) {
    return '';
  }

  return normalized;
}

export function normalizeNotesValueOrNull(value: string | null | undefined): string | null {
  const normalized = normalizeNotesValue(value);
  return normalized.length > 0 ? normalized : null;
}

function isHtmlWithoutMeaningfulContent(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed.startsWith('<') || !HTML_TAG_PATTERN.test(trimmed)) {
    return false;
  }

  if (typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = trimmed;
    const hasTextContent = (container.textContent || '').trim().length > 0;

    if (hasTextContent) {
      return false;
    }

    return container.querySelector(MEANINGFUL_STRUCTURE_SELECTOR) === null;
  }

  const strippedText = trimmed.replace(/<[^>]*>/g, '').trim();
  return strippedText.length === 0 && !MEANINGFUL_STRUCTURE_TAG_PATTERN.test(trimmed);
}
