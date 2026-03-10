function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoneyValue(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
}

function extractCurrencyCode(...values) {
  for (const value of values) {
    const text = normalizeWhitespace(value);
    if (!text) {
      continue;
    }

    const codeMatch = text.match(/\b([A-Z]{3})\b/);
    if (codeMatch) {
      return codeMatch[1];
    }

    const lower = text.toLowerCase();
    if (/\bchf\b/.test(lower) || /\bfr\.?\b/.test(lower)) {
      return 'CHF';
    }
    if (/\u20ac/.test(text)) {
      return 'EUR';
    }
    if (/\u00a3/.test(text)) {
      return 'GBP';
    }
    if (/\u00a5/.test(text)) {
      return 'JPY';
    }
    if (/\u20a9/.test(text)) {
      return 'KRW';
    }
    if (/\$/.test(text)) {
      return 'USD';
    }
  }

  return null;
}

function extractGameId(rawGameId, rawUrl) {
  const gameId = normalizeWhitespace(rawGameId);
  if (gameId) {
    return gameId;
  }

  const url = normalizeWhitespace(rawUrl);
  const match = url.match(/\/game\/(\d+)\b/);
  return match ? match[1] : null;
}

function isFreePriceLabel(priceText) {
  const normalized = normalizeWhitespace(priceText).toLowerCase();
  return /\bfree\b/.test(normalized);
}

export function normalizeCandidate(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const title = normalizeWhitespace(raw.title);
  if (!title) {
    return null;
  }

  const priceText = normalizeWhitespace(raw.priceText);
  const oldPriceText = normalizeWhitespace(raw.oldPriceText);
  const discountText = normalizeWhitespace(raw.discountText);
  const url = normalizeWhitespace(raw.url);
  const isFree = isFreePriceLabel(priceText);

  const amountMatch = priceText.match(/(\d+(?:[.,]\d{1,2})?)/);
  const regularAmountMatch = oldPriceText.match(/(\d+(?:[.,]\d{1,2})?)/);
  const discountMatch = discountText.match(/-?\s*(\d{1,3})\s*%/);
  const amount = parseMoneyValue(amountMatch ? amountMatch[1] : null);

  return {
    title,
    priceText,
    currency: extractCurrencyCode(priceText, oldPriceText),
    amount: isFree ? 0 : amount,
    regularAmount: parseMoneyValue(regularAmountMatch ? regularAmountMatch[1] : null),
    discountPercent: discountMatch ? Number.parseInt(discountMatch[1], 10) : null,
    isFree,
    url: url || null,
    gameId: extractGameId(raw.gameId, url)
  };
}
