export const METACRITIC_SEARCH_RESULTS_CONTAINER_SELECTOR = '[data-testid="search-results"]';
export const METACRITIC_SEARCH_RESULT_ROW_SELECTOR =
  '[data-testid="search-result-item"], [data-testid="search-results"] [data-testid="result-item"], .c-finderProductCard, article:has(a[href*="/game/"]):has([data-testid="product-metascore"], [data-testid="critic-score"], [data-testid="product-release-date"], time)';
export const METACRITIC_SEARCH_RESULT_LINK_SELECTOR = 'a[href*="/game/"]';
export const METACRITIC_SEARCH_RESULT_METADATA_SELECTOR =
  '[data-testid="product-metascore"], [data-testid="critic-score"], [data-testid="product-platform"], [data-testid="platform"], [data-testid="product-release-date"], time, [data-testid*="result"]';
export const METACRITIC_SEARCH_RESULT_FALLBACK_READY_SELECTOR = `article:has(${METACRITIC_SEARCH_RESULT_LINK_SELECTOR}):has(${METACRITIC_SEARCH_RESULT_METADATA_SELECTOR})`;
export const METACRITIC_SEARCH_RESULTS_READY_SELECTOR = `${METACRITIC_SEARCH_RESULT_ROW_SELECTOR}, ${METACRITIC_SEARCH_RESULT_FALLBACK_READY_SELECTOR}, ${METACRITIC_SEARCH_RESULTS_CONTAINER_SELECTOR} ${METACRITIC_SEARCH_RESULT_LINK_SELECTOR}`;

export function extractMetacriticSearchResults(config = {}) {
  // Current parsing path (2026-03-17): rely on /game/ links and nearby metadata blocks.
  const rowSelectorInPage = typeof config.rowSelector === 'string' ? config.rowSelector.trim() : '';
  const gameLinkSelectorInPage =
    typeof config.gameLinkSelector === 'string' && config.gameLinkSelector.trim().length > 0
      ? config.gameLinkSelector.trim()
      : 'a[href*="/game/"]';
  const scoreSelectorInPage =
    '[data-testid="product-metascore"] span, [data-testid="critic-score"] span, .c-siteReviewScore span, .metascore_w';
  const platformSelectorInPage =
    '[data-testid="product-platform"], [data-testid="platform"], .c-finderProductCard_meta';
  const releaseDateSelectorInPage =
    '[data-testid="product-release-date"], time, .c-finderProductCard_meta';
  const titleSelectorInPage =
    '[data-testid="product-title"], h3, h4, .c-finderProductCard_title, a.c-finderProductCard_container';
  const canonicalMetacriticOriginInPage = 'https://www.metacritic.com';
  const platformTailPatternInPage =
    /(nintendo switch|playstation\s*5|playstation\s*4|ps5|ps4|xbox one|xbox series x(?:\s*[|/]\s*s)?|xbox series s|\bpc\b|windows)(?:\s*(?:[1-9]\d?|100|tbd))?\s*$/i;
  const scoreTailPatternInPage = /\s*(?:[1-9]\d?|100|tbd)\s*$/i;
  const metadataGameTailPatternInPage = /game\s*$/i;

  const isAllowedMetacriticHostnameInPage = (rawHostname) => {
    const hostname = String(rawHostname ?? '')
      .toLowerCase()
      .trim();
    return hostname === 'www.metacritic.com' || hostname === 'metacritic.com';
  };

  const normalizeMetacriticHrefInPage = (rawHref) => {
    const href = String(rawHref ?? '').trim();
    if (href.length === 0) {
      return null;
    }

    try {
      const url = new URL(href, canonicalMetacriticOriginInPage);
      if (!isAllowedMetacriticHostnameInPage(url.hostname) || !url.pathname.startsWith('/game/')) {
        return null;
      }

      return `${canonicalMetacriticOriginInPage}${url.pathname}`;
    } catch {
      return null;
    }
  };

  const normalizeCandidateImageUrlInPage = (rawImageUrl) => {
    const imageUrl = String(rawImageUrl ?? '').trim();
    if (imageUrl.length === 0) {
      return null;
    }

    try {
      const url = new URL(imageUrl, canonicalMetacriticOriginInPage);
      if (/^\/provider\//i.test(url.pathname)) {
        return null;
      }

      return /^https?:$/i.test(url.protocol) ? url.toString() : null;
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

    return null;
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
    const hasXboxSeriesXS = /\bxbox series x\s*(?:\||\/)\s*s\b/u.test(text);
    const hasXboxSeriesX = /\bxbox series x\b/u.test(text);
    const hasXboxSeriesS = /\bxbox series s\b/u.test(text);
    if (hasXboxSeriesXS || (hasXboxSeriesX && hasXboxSeriesS)) {
      return 'Xbox Series X|S';
    }
    if (hasXboxSeriesX) {
      return 'Xbox Series X';
    }
    if (hasXboxSeriesS) {
      return 'Xbox Series S';
    }
    if (/\bpc\b/u.test(text) || /\bwindows\b/u.test(text)) {
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
    const platformTailMatch = withoutDateTail.match(platformTailPatternInPage);
    let withoutPlatformTail = withoutDateTail;

    if (
      platformTailMatch &&
      typeof platformTailMatch.index === 'number' &&
      platformTailMatch.index > 0
    ) {
      const prefix = withoutDateTail.slice(0, platformTailMatch.index);
      const trimmedPrefix = prefix.trimEnd();
      const hasTrailingScore = scoreTailPatternInPage.test(platformTailMatch[0]);
      const hasGameMetadataMarker = metadataGameTailPatternInPage.test(trimmedPrefix);

      if (hasTrailingScore || hasGameMetadataMarker) {
        withoutPlatformTail = hasGameMetadataMarker
          ? trimmedPrefix.replace(metadataGameTailPatternInPage, '')
          : trimmedPrefix;
      }
    }

    return withoutPlatformTail.replace(/\s+/g, ' ').trim();
  };

  const extractCandidateTitleTextInPage = (element) => {
    if (!element) {
      return '';
    }

    const directText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (directText.length > 0) {
      return directText;
    }

    return String(element.textContent ?? '').trim();
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

  const extractCandidateImageUrlInPage = (element) => {
    if (!element) {
      return null;
    }

    const imageEl = element.querySelector('img');
    if (!imageEl) {
      return null;
    }

    const src =
      String(imageEl.currentSrc ?? '').trim() ||
      String(imageEl.getAttribute('src') ?? '').trim() ||
      String(imageEl.getAttribute('data-src') ?? '').trim();

    return normalizeCandidateImageUrlInPage(src);
  };

  const rows =
    rowSelectorInPage.length > 0 ? Array.from(document.querySelectorAll(rowSelectorInPage)) : [];

  const normalizePlatformTextInPage = (rawValue) =>
    String(rawValue ?? '')
      .replace(/^[\s\u2022·\-:]+/u, '')
      .replace(/\s*,?\s*and more\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  const normalizePayloadReleaseYearInPage = (rawReleaseDate, rawPremiereYear) => {
    const releaseDate = String(rawReleaseDate ?? '').trim();
    const releaseDateYearMatch = releaseDate.match(/\b(19|20)\d{2}\b/);
    const parsedPremiereYear =
      typeof rawPremiereYear === 'number' && Number.isInteger(rawPremiereYear)
        ? rawPremiereYear
        : null;

    if (
      parsedPremiereYear !== null &&
      /\b(tba|to be announced|early access|coming soon)\b/i.test(releaseDate) &&
      !releaseDateYearMatch
    ) {
      return null;
    }

    if (parsedPremiereYear !== null) {
      return parsedPremiereYear;
    }

    return releaseDateYearMatch ? Number.parseInt(releaseDateYearMatch[0], 10) : null;
  };

  const decodePayloadStringInPage = (rawValue) => {
    const quoted = `"${String(rawValue ?? '')}"`;

    try {
      return JSON.parse(quoted);
    } catch {
      return String(rawValue ?? '');
    }
  };

  const extractPayloadCandidatesInPage = () => {
    const extractStructuredPayloadCandidatesInPage = (scriptText) => {
      let flatData;

      try {
        flatData = JSON.parse(scriptText);
      } catch {
        return [];
      }

      if (!Array.isArray(flatData)) {
        return [];
      }

      const resolvedCache = new Map();
      const resolving = new Set();

      const resolvePayloadRefInPage = (value) => {
        if (
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < 0 ||
          value >= flatData.length
        ) {
          return value;
        }

        if (resolvedCache.has(value)) {
          return resolvedCache.get(value);
        }

        if (resolving.has(value)) {
          return null;
        }

        resolving.add(value);
        const raw = flatData[value];
        let resolved;

        if (Array.isArray(raw)) {
          resolved = raw.map((entry) => resolvePayloadRefInPage(entry));
        } else if (raw && typeof raw === 'object') {
          resolved = Object.fromEntries(
            Object.entries(raw).map(([key, entry]) => [key, resolvePayloadRefInPage(entry)])
          );
        } else {
          resolved = raw;
        }

        resolving.delete(value);
        resolvedCache.set(value, resolved);
        return resolved;
      };

      const candidates = [];
      const seenUrls = new Set();

      for (let index = 0; index < flatData.length; index += 1) {
        const rawEntry = flatData[index];
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
          continue;
        }

        if (
          !('title' in rawEntry) ||
          !('slug' in rawEntry) ||
          !('criticScoreSummary' in rawEntry) ||
          !('releaseDate' in rawEntry) ||
          !('platforms' in rawEntry)
        ) {
          continue;
        }

        const candidate = resolvePayloadRefInPage(index);
        const title = sanitizeCandidateTitleInPage(candidate?.title);
        const criticUrl = String(candidate?.criticScoreSummary?.url ?? '').trim();
        const metacriticUrl = normalizeMetacriticHrefInPage(
          criticUrl.replace(/\/critic-reviews\/$/i, '/')
        );

        if (!title || !metacriticUrl || seenUrls.has(metacriticUrl)) {
          continue;
        }

        const releaseDate = String(candidate?.releaseDate ?? '').trim();
        const releaseYearCandidate = normalizePayloadReleaseYearInPage(
          releaseDate,
          candidate?.premiereYear
        );
        const platformNames = Array.isArray(candidate?.platforms)
          ? candidate.platforms
              .map((platformEntry) => {
                if (typeof platformEntry === 'string') {
                  return platformEntry;
                }

                if (platformEntry && typeof platformEntry === 'object') {
                  return String(platformEntry.name ?? '').trim();
                }

                return '';
              })
              .filter((name) => name.length > 0)
          : [];
        const imageEntry = Array.isArray(candidate?.images) ? candidate.images[0] : null;
        const rawImageUrl =
          typeof imageEntry === 'string'
            ? imageEntry
            : String(imageEntry?.imageUrl ?? imageEntry?.url ?? '').trim();
        const normalizedImageUrl = normalizeCandidateImageUrlInPage(rawImageUrl);

        seenUrls.add(metacriticUrl);
        candidates.push({
          title,
          releaseYear: Number.isInteger(releaseYearCandidate) ? releaseYearCandidate : null,
          platform: platformNames[0] ? normalizePlatformTextInPage(platformNames[0]) : null,
          metacriticPlatforms: platformNames.map((name) => normalizePlatformTextInPage(name)),
          metacriticScore: parseMetacriticScoreInPage(candidate?.criticScoreSummary?.score),
          metacriticUrl,
          imageUrl: normalizedImageUrl,
        });
      }

      return candidates;
    };

    const payloadEntryPattern =
      /(?:\}\s*,\s*)?\d+\s*,\s*"game-title"\s*,\s*13\s*,\s*"((?:[^"\\]|\\.)+)"\s*,\s*"((?:[^"\\]|\\.)+)"([\s\S]*?)(?=(?:\}\s*,\s*)?\d+\s*,\s*"game-title"\s*,\s*13\s*,|$)/g;
    const payloadScripts = Array.from(document.querySelectorAll('script'))
      .map((script) => String(script.textContent ?? ''))
      .filter((text) => text.includes('"game-title"') && text.includes('/critic-reviews/'));

    if (payloadScripts.length === 0) {
      return [];
    }

    const payloadCandidates = [];
    const seenPayloadUrls = new Set();

    for (const scriptText of payloadScripts) {
      const structuredCandidates = extractStructuredPayloadCandidatesInPage(scriptText);
      for (const structuredCandidate of structuredCandidates) {
        if (seenPayloadUrls.has(structuredCandidate.metacriticUrl)) {
          continue;
        }

        seenPayloadUrls.add(structuredCandidate.metacriticUrl);
        payloadCandidates.push(structuredCandidate);
      }

      if (structuredCandidates.length > 0) {
        continue;
      }

      payloadEntryPattern.lastIndex = 0;
      let payloadMatch = payloadEntryPattern.exec(scriptText);

      while (payloadMatch) {
        const rawTitle = decodePayloadStringInPage(payloadMatch[1]);
        const rawSlug = decodePayloadStringInPage(payloadMatch[2]);
        const segment = String(payloadMatch[3] ?? '');
        const criticPathMatch = segment.match(/"((?:\/game\/[^"\\]+)\/critic-reviews\/)"/i);
        const derivedPath = criticPathMatch
          ? criticPathMatch[1].replace(/\/critic-reviews\/$/i, '/')
          : `/game/${rawSlug.replace(/^\/+|\/+$/g, '')}/`;
        const metacriticUrl = normalizeMetacriticHrefInPage(derivedPath);

        if (!metacriticUrl || seenPayloadUrls.has(metacriticUrl)) {
          payloadMatch = payloadEntryPattern.exec(scriptText);
          continue;
        }

        const title = sanitizeCandidateTitleInPage(rawTitle);
        if (!title) {
          payloadMatch = payloadEntryPattern.exec(scriptText);
          continue;
        }

        const releaseDateAndYearMatch = segment.match(
          /"(\d{4})(?:-\d{2}-\d{2})?"\s*,\s*(\d{4})(?=\s*,\s*\[)/
        );
        const fallbackIsoYearMatch = segment.match(/"(\d{4})-\d{2}-\d{2}"/);
        const releaseYearValue = releaseDateAndYearMatch?.[2] ?? fallbackIsoYearMatch?.[1] ?? null;
        const parsedReleaseYear = releaseYearValue ? Number.parseInt(releaseYearValue, 10) : null;
        const trailingSegment = releaseDateAndYearMatch
          ? segment.slice(releaseDateAndYearMatch.index + releaseDateAndYearMatch[0].length)
          : segment;
        const platformMatch = trailingSegment.match(
          /\[[^\]]*\]\s*,\s*\{[^}]*"name"[^}]*\}\s*,\s*"[^"]*"\s*,\s*\[[^\]]*\]\s*,\s*\{[^}]*"name"[^}]*\}\s*,\s*"([^"]+)"/
        );
        const scoreMatch = segment.match(/\/critic-reviews\/"\s*,\s*(\d{1,3})(?=\s*(?:,|\]))/);
        const parsedScore = scoreMatch ? Number.parseInt(scoreMatch[1], 10) : null;
        const imagePathMatch = segment.match(/"(https:\/\/[^"\\]+)"/i);
        const imageValue = imagePathMatch?.[1] ?? '';
        const imageUrl = normalizeCandidateImageUrlInPage(imageValue);

        seenPayloadUrls.add(metacriticUrl);
        payloadCandidates.push({
          title,
          releaseYear: Number.isInteger(parsedReleaseYear) ? parsedReleaseYear : null,
          platform: platformMatch ? normalizePlatformTextInPage(platformMatch[1]) : null,
          metacriticPlatforms: platformMatch ? [normalizePlatformTextInPage(platformMatch[1])] : [],
          metacriticScore:
            Number.isInteger(parsedScore) && parsedScore >= 1 && parsedScore <= 100
              ? parsedScore
              : null,
          metacriticUrl,
          imageUrl,
        });

        payloadMatch = payloadEntryPattern.exec(scriptText);
      }
    }

    return payloadCandidates;
  };

  const getPayloadCandidatesInPage = (() => {
    let payloadCandidates;

    return () => {
      if (payloadCandidates === undefined) {
        payloadCandidates = extractPayloadCandidatesInPage();
      }

      return payloadCandidates;
    };
  })();

  const shouldMergePayloadCandidatesInPage = (items) =>
    items.length === 0 ||
    items.some(
      (item) =>
        item.releaseYear === null ||
        item.platform === null ||
        item.metacriticScore === null ||
        item.imageUrl === null
    );

  const mergePayloadCandidatesInPage = (items) => {
    if (!shouldMergePayloadCandidatesInPage(items)) {
      return items;
    }

    const payloadCandidates = getPayloadCandidatesInPage();
    if (payloadCandidates.length === 0) {
      return items;
    }

    const payloadByUrl = new Map(
      payloadCandidates
        .filter((candidate) => typeof candidate.metacriticUrl === 'string')
        .map((candidate) => [candidate.metacriticUrl, candidate])
    );

    if (items.length === 0) {
      return payloadCandidates;
    }

    return items.map((item) => {
      const payloadCandidate = payloadByUrl.get(item.metacriticUrl);
      if (!payloadCandidate) {
        return item;
      }

      return {
        ...item,
        title:
          typeof payloadCandidate.title === 'string' && payloadCandidate.title.trim().length > 0
            ? payloadCandidate.title
            : item.title,
        releaseYear: item.releaseYear ?? payloadCandidate.releaseYear ?? null,
        platform: payloadCandidate.platform ?? item.platform ?? null,
        metacriticPlatforms:
          Array.isArray(payloadCandidate.metacriticPlatforms) &&
          payloadCandidate.metacriticPlatforms.length > 0
            ? payloadCandidate.metacriticPlatforms
            : Array.isArray(item.metacriticPlatforms)
              ? item.metacriticPlatforms
              : item.platform
                ? [item.platform]
                : [],
        metacriticScore: item.metacriticScore ?? payloadCandidate.metacriticScore ?? null,
        imageUrl: item.imageUrl ?? payloadCandidate.imageUrl ?? null,
      };
    });
  };

  const parsed = [];
  const genericTitles = new Set(['games', 'search results for " "']);

  for (const row of rows) {
    const nestedGameLinkEl = row.matches(gameLinkSelectorInPage)
      ? row
      : row.querySelector(gameLinkSelectorInPage);

    const urlOnRow = normalizeMetacriticHrefInPage(row.getAttribute('href'));
    const urlOnNestedLink = normalizeMetacriticHrefInPage(nestedGameLinkEl?.getAttribute('href'));
    const resultTypeTag = String(
      row.querySelector('[data-testid="tag-list"] .c-tagList_button, [data-testid="tag-list"] span')
        ?.textContent ?? ''
    )
      .toLowerCase()
      .trim();
    const isGameByHref = Boolean(urlOnRow || urlOnNestedLink);
    const isGameByTag = resultTypeTag === 'game';
    if (!isGameByHref && !isGameByTag) {
      continue;
    }

    const titleEl = row.querySelector(titleSelectorInPage) || nestedGameLinkEl || row;
    const title = sanitizeCandidateTitleInPage(extractCandidateTitleTextInPage(titleEl));
    if (!title || genericTitles.has(title.toLowerCase())) {
      continue;
    }

    const url = urlOnNestedLink ?? urlOnRow;
    if (!url) {
      continue;
    }

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
    const yearMatch =
      releaseDateText.match(/\b(19|20)\d{2}\b/) ?? title.match(/\((19|20)\d{2}\)|\b(19|20)\d{2}\b/);
    const releaseYear = yearMatch ? Number.parseInt(yearMatch[0], 10) : null;

    const rowText = String(row.textContent ?? '').trim();
    const platformEl = row.querySelector(platformSelectorInPage);
    const platform = platformEl
      ? normalizePlatformTextInPage(platformEl.textContent ?? '')
      : detectPlatformInTextInPage(rowText);

    const imageUrl = extractCandidateImageUrlInPage(row);

    parsed.push({
      title,
      releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
      platform: platform && platform.length > 0 ? platform : null,
      metacriticPlatforms: platform && platform.length > 0 ? [platform] : [],
      metacriticScore: scoreValue,
      metacriticUrl: url,
      imageUrl: imageUrl && imageUrl.length > 0 ? imageUrl : null,
    });
  }

  if (parsed.length > 0) {
    return mergePayloadCandidatesInPage(parsed);
  }

  // Fallback parsing (working up to: 2026-03-17).
  const fallbackLinks = Array.from(document.querySelectorAll(gameLinkSelectorInPage));
  const seenUrls = new Set();

  for (const link of fallbackLinks) {
    const url = normalizeMetacriticHrefInPage(link.getAttribute('href'));
    if (!url || seenUrls.has(url)) {
      continue;
    }

    const container = findCandidateContainerInPage(link);
    if (!container) {
      continue;
    }

    const titleEl = container.querySelector(titleSelectorInPage) || link;
    const title = sanitizeCandidateTitleInPage(extractCandidateTitleTextInPage(titleEl));
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
    const yearMatch =
      releaseDateText.match(/\b(19|20)\d{2}\b/) ?? title.match(/\((19|20)\d{2}\)|\b(19|20)\d{2}\b/);
    const releaseYear = yearMatch ? Number.parseInt(yearMatch[0], 10) : null;

    const containerText = String(container.textContent ?? '').trim();
    const platformEl = container.querySelector(platformSelectorInPage);
    const platform = platformEl
      ? normalizePlatformTextInPage(platformEl.textContent ?? '')
      : detectPlatformInTextInPage(containerText);

    const imageUrl = extractCandidateImageUrlInPage(container);

    seenUrls.add(url);
    parsed.push({
      title,
      releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
      platform: platform && platform.length > 0 ? platform : null,
      metacriticPlatforms: platform && platform.length > 0 ? [platform] : [],
      metacriticScore: scoreValue,
      metacriticUrl: url,
      imageUrl: imageUrl && imageUrl.length > 0 ? imageUrl : null,
    });
  }

  return mergePayloadCandidatesInPage(parsed);
}
