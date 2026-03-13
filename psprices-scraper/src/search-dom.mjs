export const RESULT_CARD_COVER_IMAGE_SELECTOR =
  'a[href*="/game/"] .card-wrapper .aspect-square img.object-contain, a[href*="/game/"] .card-wrapper img.object-contain, a[href*="/game/"] img[alt]';

export function extractResultCardImageUrl(root) {
  if (!root || typeof root.querySelector !== 'function') {
    return '';
  }

  const imageElement = root.querySelector(RESULT_CARD_COVER_IMAGE_SELECTOR);
  if (!(imageElement instanceof root.ownerDocument.defaultView.HTMLImageElement)) {
    return '';
  }

  return String(
    imageElement.currentSrc ||
      imageElement.src ||
      imageElement.getAttribute('src') ||
      imageElement.getAttribute('data-src') ||
      ''
  )
    .replace(/\s+/g, ' ')
    .trim();
}
