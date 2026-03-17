const KEYWORD_SYNONYM_MAP: Record<string, string> = {
  'turn-based': 'turn-based combat',
  'turn-based rpg': 'turn-based combat',
  'party system': 'party-based combat',
  'party-based': 'party-based combat',
  jrpg: 'japanese rpg',
};

const KEYWORD_PLATFORM_ARTIFACT_RE = /\b(playstation|xbox|switch)\b/i;
const KEYWORD_YEAR_RE = /\b20\d{2}\b/;
const KEYWORD_AWARD_RE = /\b(award|nominee|winner)\b/i;
const KEYWORD_EVENT_RE = /\b(expo|show|conference|experience)\b/i;
const KEYWORD_COMMERCIAL_RE = /\bsoundtrack release\b/i;
const KEYWORD_STOREFRONT_ARTIFACT_RE =
  /\b(steam|ea app|games on demand|digital distribution|playstation plus|playstation network|xbox live|luna plus|downloadable content)\b/i;
const KEYWORD_SUPPORT_ARTIFACT_RE =
  /\b(controller support|dualsense support for pc|dualshock 4 support for pc|xbox controller support for pc|playstation trophies|steam cloud|steam trading cards|steam families|steam deck|xbox one backwards compatibility)\b/i;
const KEYWORD_AVAILABILITY_ARTIFACT_RE = /\bavailable on\b/i;

export function normalizeKeyword(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length === 0) {
    return null;
  }

  return KEYWORD_SYNONYM_MAP[normalized] ?? normalized;
}

export function normalizeKeywords(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => normalizeKeyword(value))
        .filter((value): value is string => Boolean(value))
    ),
  ];
}

export function isKeywordNoise(value: string): boolean {
  if (KEYWORD_YEAR_RE.test(value)) {
    return true;
  }

  if (KEYWORD_AWARD_RE.test(value)) {
    return true;
  }

  if (KEYWORD_EVENT_RE.test(value)) {
    return true;
  }

  if (KEYWORD_PLATFORM_ARTIFACT_RE.test(value)) {
    return true;
  }

  if (KEYWORD_COMMERCIAL_RE.test(value)) {
    return true;
  }

  if (KEYWORD_STOREFRONT_ARTIFACT_RE.test(value)) {
    return true;
  }

  if (KEYWORD_SUPPORT_ARTIFACT_RE.test(value)) {
    return true;
  }

  if (KEYWORD_AVAILABILITY_ARTIFACT_RE.test(value)) {
    return true;
  }

  return value.split(/\s+/).length > 5;
}

export function prepareKeywords(values: string[]): string[] {
  return normalizeKeywords(values).filter((value) => !isKeywordNoise(value));
}
