export function extractMetacriticSearchResults() {
  // Current parsing path (2026-03-17): rely on /game/ links and nearby metadata blocks.
  const rowSelectorInPage =
    '[data-testid="search-result-item"], [data-testid="search-results"] [data-testid="result-item"], .c-finderProductCard';
  const scoreSelectorInPage =
    '[data-testid="product-metascore"] span, [data-testid="critic-score"] span, .c-siteReviewScore span, .metascore_w';
  const platformSelectorInPage =
    '[data-testid="product-platform"], [data-testid="platform"], .c-finderProductCard_meta';
  const releaseDateSelectorInPage =
    '[data-testid="product-release-date"], time, .c-finderProductCard_meta';
  const titleSelectorInPage =
    '[data-testid="product-title"], h3, h4, .c-finderProductCard_title, a.c-finderProductCard_container';

  const normalizeMetacriticHrefInPage = (rawHref) => {
    const href = String(rawHref ?? '').trim();
    if (href.length === 0) {
      return null;
    }

    const absolute = href.startsWith('http') ? href : `https://www.metacritic.com${href}`;

    try {
      const url = new URL(absolute);
      if (!url.hostname.includes('metacritic.com') || !url.pathname.includes('/game/')) {
        return null;
      }

      return `${url.origin}${url.pathname}`;
    } catch {
      return null;
    }
  };

  const findCandidateContainerInPage = (link) => {
    let current = link;
    for (let depth = 0; depth < 7 && current; depth += 1) {
      const hasScore = Boolean(current.querySelector(scoreSelectorInPage));
      const hasPlatform = Boolean(current.querySelector(platformSelectorInPage));
      const hasReleaseDate = Boolean(current.querySelector(releaseDateSelectorInPage));
      const hasResultTestId = String(current.getAttribute('data-testid') ?? '').includes('result');

      if (hasScore || hasPlatform || hasReleaseDate || hasResultTestId) {
        return current;
      }

      current = current.parentElement;
    }

    return link.parentElement ?? link;
  };

  const detectPlatformInTextInPage = (rawValue) => {
    const text = String(rawValue ?? '').toLowerCase();
    if (text.includes('nintendo switch')) {
      return 'Nintendo Switch';
    }
    if (text.includes('playstation 5') || text.includes('ps5')) {
      return 'PlayStation 5';
    }
    if (text.includes('playstation 4') || text.includes('ps4')) {
      return 'PlayStation 4';
    }
    if (text.includes('xbox one')) {
      return 'Xbox One';
    }
    if (text.includes('xbox series x') || text.includes('xbox series s')) {
      return 'Xbox Series X';
    }
    if (text.includes('pc') || text.includes('windows')) {
      return 'PC';
    }
    return null;
  };

  const sanitizeCandidateTitleInPage = (rawValue) => {
    const raw = String(rawValue ?? '').trim();
    if (raw.length === 0) {
      return '';
    }

    const withoutDateTail = raw.replace(
      /\s*(game\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}[\s\S]*$/i,
      ''
    );
    const withoutPlatformTail = withoutDateTail.replace(
      /\s*(game\s*)?(nintendo switch|playstation\s*5|playstation\s*4|ps5|ps4|xbox one|xbox series x|xbox series s|pc|windows)[\s\S]*$/i,
      ''
    );

    return withoutPlatformTail.replace(/\s+/g, ' ').trim();
  };

  const parseMetacriticScoreInPage = (rawValue) => {
    const text = String(rawValue ?? '')
      .toLowerCase()
      .trim();
    if (text.length === 0 || text.includes('tbd') || text.includes('null')) {
      return null;
    }

    const match = text.match(/\b([1-9]\d?|100)\b/);
    if (!match) {
      return null;
    }

    const parsed = Number.parseInt(match[1], 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
  };

  const rows = Array.from(document.querySelectorAll(rowSelectorInPage));

  const normalizePlatformTextInPage = (rawValue) =>
    String(rawValue ?? '')
      .replace(/^[\s\u2022·\-:]+/u, '')
      .replace(/\s*,?\s*and more\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  const parsed = [];

  for (const row of rows) {
    const nestedGameLinkEl = row.matches('a[href*="/game/"]')
      ? row
      : row.querySelector('a[href*="/game/"]');

    const hrefOnRow = String(row.getAttribute('href') ?? '').trim();
    const hrefOnNested = String(nestedGameLinkEl?.getAttribute('href') ?? '').trim();
    const resultTypeTag = String(
      row.querySelector('[data-testid="tag-list"] .c-tagList_button, [data-testid="tag-list"] span')
        ?.textContent ?? ''
    )
      .toLowerCase()
      .trim();
    const isGameByHref =
      hrefOnRow.startsWith('/game/') ||
      hrefOnRow.includes('/game/') ||
      hrefOnNested.startsWith('/game/') ||
      hrefOnNested.includes('/game/');
    const isGameByTag = resultTypeTag === 'game';
    if (!isGameByHref && !isGameByTag) {
      continue;
    }

    const titleEl =
      row.querySelector(titleSelectorInPage) || row.querySelector('a[href*="/game/"]');
    const title = titleEl ? sanitizeCandidateTitleInPage(titleEl.textContent ?? '') : '';
    if (!title) {
      continue;
    }

    const linkEl = nestedGameLinkEl;
    const href = linkEl ? String(linkEl.getAttribute('href') ?? '').trim() : '';
    const url = href.startsWith('http')
      ? href
      : href.startsWith('/')
        ? `https://www.metacritic.com${href}`
        : null;

    const scoreEl =
      row.querySelector(scoreSelectorInPage) ??
      row.querySelector(
        '[data-testid="product-metascore"] [aria-label*="Metascore"], [data-testid="product-metascore"] [title*="Metascore"], [aria-label*="Metascore"], [title*="Metascore"]'
      );
    const scoreRaw = scoreEl
      ? String(
          scoreEl.textContent ??
            scoreEl.getAttribute('aria-label') ??
            scoreEl.getAttribute('title') ??
            ''
        ).trim()
      : '';
    const scoreValue = parseMetacriticScoreInPage(scoreRaw);

    const releaseDateText = String(
      row.querySelector(releaseDateSelectorInPage)?.textContent ?? ''
    ).trim();
    const rowText = String(row.textContent ?? '').trim();
    const yearMatch =
      releaseDateText.match(/\b(19|20)\d{2}\b/) ??
      rowText.match(/\b(19|20)\d{2}\b/) ??
      title.match(/\((19|20)\d{2}\)|\b(19|20)\d{2}\b/);
    const releaseYear = yearMatch ? Number.parseInt(yearMatch[0], 10) : null;

    const platformEl = row.querySelector(platformSelectorInPage);
    const platform = platformEl
      ? normalizePlatformTextInPage(platformEl.textContent ?? '')
      : detectPlatformInTextInPage(rowText);

    const imageEl = row.querySelector('img');
    const imageUrl = imageEl ? String(imageEl.getAttribute('src') ?? '').trim() : null;

    parsed.push({
      title,
      releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
      platform: platform && platform.length > 0 ? platform : null,
      metacriticScore: scoreValue,
      metacriticUrl: url,
      imageUrl: imageUrl && imageUrl.length > 0 ? imageUrl : null,
    });
  }

  if (parsed.length > 0) {
    return parsed;
  }

  // Fallback parsing (working up to: 2026-03-17).
  const fallbackLinks = Array.from(document.querySelectorAll('a[href*="/game/"]'));
  const seenUrls = new Set();
  const genericTitles = new Set(['games']);

  for (const link of fallbackLinks) {
    const url = normalizeMetacriticHrefInPage(link.getAttribute('href'));
    if (!url || seenUrls.has(url)) {
      continue;
    }

    const container = findCandidateContainerInPage(link);
    const titleEl = container.querySelector(titleSelectorInPage) || link;
    const title = sanitizeCandidateTitleInPage(titleEl?.textContent ?? '');
    if (!title || genericTitles.has(title.toLowerCase())) {
      continue;
    }

    const scoreEl =
      container.querySelector(scoreSelectorInPage) ??
      container.querySelector(
        '[data-testid="product-metascore"] [aria-label*="Metascore"], [data-testid="product-metascore"] [title*="Metascore"], [aria-label*="Metascore"], [title*="Metascore"]'
      );
    const scoreRaw = scoreEl
      ? String(
          scoreEl.textContent ??
            scoreEl.getAttribute('aria-label') ??
            scoreEl.getAttribute('title') ??
            ''
        ).trim()
      : '';
    const scoreValue = parseMetacriticScoreInPage(scoreRaw);

    const releaseDateText = String(
      container.querySelector(releaseDateSelectorInPage)?.textContent ?? ''
    ).trim();
    const containerText = String(container.textContent ?? '').trim();
    const yearMatch =
      releaseDateText.match(/\b(19|20)\d{2}\b/) ??
      containerText.match(/\b(19|20)\d{2}\b/) ??
      title.match(/\((19|20)\d{2}\)|\b(19|20)\d{2}\b/);
    const releaseYear = yearMatch ? Number.parseInt(yearMatch[0], 10) : null;

    const platformEl = container.querySelector(platformSelectorInPage);
    const platform = platformEl
      ? normalizePlatformTextInPage(platformEl.textContent ?? '')
      : detectPlatformInTextInPage(containerText);

    const imageEl = container.querySelector('img');
    const imageUrl = imageEl ? String(imageEl.getAttribute('src') ?? '').trim() : null;

    seenUrls.add(url);
    parsed.push({
      title,
      releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
      platform: platform && platform.length > 0 ? platform : null,
      metacriticScore: scoreValue,
      metacriticUrl: url,
      imageUrl: imageUrl && imageUrl.length > 0 ? imageUrl : null,
    });
  }

  return parsed;
}
