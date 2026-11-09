export function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The title as given, plus a punctuation-free version when that differs. PSPrices search ignores
 * case, so a version that differs only in case would cost a second identical search (and, while
 * Cloudflare blocks the scraper, a second FlareSolverr call).
 */
export function buildSearchTitleVariants(title) {
  const base = String(title ?? '').trim();
  if (base.length === 0) {
    return [];
  }

  const titleCase = normalizeTitle(base)
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

  return titleCase.length > 0 && titleCase.toLowerCase() !== base.toLowerCase()
    ? [base, titleCase]
    : [base];
}

/**
 * Runs the search for each title variant in turn and merges their candidates. A variant that fails
 * doesn't discard what the others found: its error is returned in `failures` for logging. When
 * nothing was found and any variant failed, the first error is thrown instead: the failed variant
 * might have been the one that matched, so the result can't be reported as "no match".
 */
export async function searchTitleVariants(variants, searchVariant) {
  const candidates = [];
  const failures = [];

  for (const variant of variants) {
    try {
      candidates.push(...(await searchVariant(variant)));
    } catch (error) {
      failures.push({ variant, error });
    }
  }

  if (failures.length > 0 && candidates.length === 0) {
    throw failures[0].error;
  }

  return { candidates, failures };
}
