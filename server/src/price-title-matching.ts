import { round2 } from './utils/round.js';

// Title matching for store price lookups: given the title we're looking for and a store's search
// results, picks the candidate that is the same game, or none when the match isn't clear enough.
// Scoring works on a "core" title (platform suffixes, edition words and low-signal words removed,
// sequel numerals folded so "II" and "2" match), then edition-type suffixes (deluxe, bundle,
// expansion, ...) shape the score so the base game wins over editions of it.

/** The fields of a store search result that matching reads. */
export interface TitleMatchCandidate {
  title: string | null;
  url: string | null;
  amount: number | null;
  /** A numeric store ID, used only as a late tie-break (lower wins). */
  gameId?: string | null;
  /** Higher wins between otherwise equal candidates. */
  metadataQualityScore?: number | null;
}

export interface TitleMatchInfo {
  queryTitle: string;
  matchedTitle: string | null;
  score: number | null;
  confidence: 'high' | 'low' | 'none';
}

export interface TitleMatchResult<T extends TitleMatchCandidate> {
  /** The matched candidate, or null when no candidate is a confident match. */
  best: T | null;
  match: TitleMatchInfo;
  /** The best-ranked candidates, best first, with their shaped scores. */
  candidates: Array<T & { score: number }>;
}

export interface TitleMatchOptions<T extends TitleMatchCandidate> {
  /** A candidate this returns true for wins outright (e.g. the store page the game was pinned to). */
  isPreferred?: (candidate: T) => boolean;
  /** How many ranked candidates to return. */
  maxCandidates?: number;
}

const DEFAULT_MAX_CANDIDATES = 30;

type TitleSuffixClass =
  'base' | 'standard' | 'complete' | 'ultimate' | 'deluxe' | 'bundle' | 'expansion' | 'other';

interface RankedTitleMatchCandidate<T extends TitleMatchCandidate = TitleMatchCandidate> {
  candidate: T;
  score: number;
  coreScore: number;
  suffixClass: TitleSuffixClass;
  suffixRank: number;
  hasPlatformSuffix: boolean;
  hasContextPlatformSuffix: boolean;
}

type PlatformMarkerContext = 'playstation' | 'switch' | 'xbox' | null;

const TITLE_MATCH_MIN_SCORE = 70;
const TITLE_MATCH_MIN_GAP = 8;
const MAX_SEQUEL_NUMBER_TOKEN = 20;
const SUFFIX_RANK_STRONG_CORE_THRESHOLD = TITLE_MATCH_MIN_SCORE;
const SUFFIX_STANDARD_PATTERNS = [/\bstandard(?: edition)?\b/];
const SUFFIX_COMPLETE_PATTERNS = [/\bcomplete(?: edition)?\b/];
const SUFFIX_ULTIMATE_PATTERNS = [
  /\bultimate(?: edition)?\b/,
  /\bgold(?: edition)?\b/,
  /\bgoty\b/,
  /\bgame of the year(?: edition)?\b/,
  /\blegendary(?: edition)?\b/,
];
const SUFFIX_DELUXE_PATTERNS = [
  /\bdigital deluxe\b/,
  /\bsuper deluxe\b/,
  /\bdeluxe(?: edition)?\b/,
];
const SUFFIX_BUNDLE_PATTERNS = [/\bcollection\b/, /\bbundle\b/];
const SUFFIX_EXPANSION_PATTERNS = [
  /\berweiterungspaket\b/,
  /\bexpansion(?: pack)?\b/,
  /\bdlc\b/,
  /\badd ?on\b/,
  /\baddon\b/,
  /\bupgrade\b/,
  /\bnext gen upgrade\b/,
  /\bps5 upgrade\b/,
  /\bseries x upgrade\b/,
  /\bseason pass\b/,
  /\bpass\b/,
  /\bstory pack\b/,
  /\bpack\b/,
  /\bepisode\b/,
  /\bchapter\b/,
];
const PLATFORM_TRAILING_QUALIFIER_FRAGMENT =
  '(?:standard|complete|ultimate|gold|goty|game|of|the|year|legendary|digital|super|deluxe|collection|bundle|erweiterungspaket|expansion|dlc|add|on|addon|upgrade|next|gen|season|pass|story|pack|episode|chapter|edition|remastered|remake)';
const PLAYSTATION_SUFFIX_BEFORE_QUALIFIER_PATTERNS = [
  buildPlatformSuffixBeforeQualifierPattern('ps5|ps4|playstation 5|playstation 4'),
];
const SWITCH_SUFFIX_BEFORE_QUALIFIER_PATTERNS = [
  buildPlatformSuffixBeforeQualifierPattern('nintendo switch 2|switch 2|nintendo switch|switch'),
];
const XBOX_SUFFIX_BEFORE_QUALIFIER_PATTERNS = [
  buildPlatformSuffixBeforeQualifierPattern(
    'xbox one|xbox series x s|xbox series x|xbox series s|xbox series|series x s|series x|series s|xbox'
  ),
];
const PLAYSTATION_SUFFIX_PATTERNS = [/\b(?:ps5|ps4|playstation 5|playstation 4)(?: edition)?$/];
const SWITCH_SUFFIX_PATTERNS = [
  /\b(?:nintendo switch 2|switch 2|nintendo switch|switch)(?: edition)?$/,
];
const XBOX_SUFFIX_PATTERNS = [
  /\b(?:xbox one|xbox series x s|xbox series x|xbox series s|xbox series|series x s|series x|series s|xbox)(?: edition)?$/,
];
const ROMAN_NUMERAL_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};
const ROMAN_NUMERAL_SYMBOLS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/**
 * Ranks `candidates` against `queryTitle` for `platform` (a store platform name such as "PS5" or
 * "Switch", which decides which platform suffixes count as the same platform) and picks the match.
 * A preferred candidate wins outright; otherwise the best one is only returned when it scores at
 * least TITLE_MATCH_MIN_SCORE and stands clear of the runner-up (or wins a resolvable tie).
 */
export function matchCandidatesByTitle<T extends TitleMatchCandidate>(
  queryTitle: string,
  platform: string | null | undefined,
  candidates: readonly T[],
  options: TitleMatchOptions<T> = {}
): TitleMatchResult<T> {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  if (candidates.length === 0) {
    return {
      best: null,
      match: { queryTitle, matchedTitle: null, score: null, confidence: 'none' },
      candidates: [],
    };
  }

  const platformContext = derivePlatformMarkerContext(platform);
  const expectedCore = buildCoreTitleForScoring(queryTitle, platformContext).coreTitle;
  const ranked = candidates
    .map((candidate) => {
      const titleValue = candidate.title ?? '';
      const candidateCore = buildCoreTitleForScoring(titleValue, platformContext);
      const coreScore = scoreCoreTitleMatch(expectedCore, candidateCore.coreTitle);
      const suffixClass = classifyTitleSuffixClass(candidateCore.suffixInspectionTitle);
      const score = round2(
        applySuffixShaping({
          coreScore,
          suffixClass,
          strongCoreThreshold: SUFFIX_RANK_STRONG_CORE_THRESHOLD,
        })
      );
      return {
        candidate,
        score,
        coreScore,
        suffixClass,
        suffixRank: resolveSuffixRank(suffixClass),
        hasPlatformSuffix: candidateCore.hasPlatformSuffix,
        hasContextPlatformSuffix: candidateCore.hasContextPlatformSuffix,
      } satisfies RankedTitleMatchCandidate<T>;
    })
    .sort((left, right) => compareRankedTitleMatchCandidates(left, right));
  const rankedCandidates = ranked.slice(0, maxCandidates).map((entry) => ({
    ...entry.candidate,
    score: round2(entry.score),
  }));

  const isPreferred = options.isPreferred;
  const preferredMatch = isPreferred
    ? (ranked.find((entry) => isPreferred(entry.candidate)) ?? null)
    : null;
  if (preferredMatch) {
    return {
      best: preferredMatch.candidate,
      match: {
        queryTitle,
        matchedTitle: preferredMatch.candidate.title,
        score: round2(preferredMatch.score),
        confidence: 'high',
      },
      candidates: rankedCandidates,
    };
  }

  const best = ranked[0];
  const second = ranked[1];
  const hasHighConfidenceMatch =
    best.coreScore >= TITLE_MATCH_MIN_SCORE &&
    (ranked.length === 1 ||
      best.coreScore - second.coreScore >= TITLE_MATCH_MIN_GAP ||
      isResolvedStrongCoreSuffixTie(best, second) ||
      isResolvedEquivalentStrongCoreTie(best, second) ||
      isResolvedDuplicateTie(best, second));

  return {
    best: hasHighConfidenceMatch ? best.candidate : null,
    match: {
      queryTitle,
      matchedTitle: best.candidate.title,
      score: round2(best.score),
      confidence: hasHighConfidenceMatch ? 'high' : 'low',
    },
    candidates: rankedCandidates,
  };
}

function resolveCandidateQualityScore(candidate: TitleMatchCandidate): number {
  return typeof candidate.metadataQualityScore === 'number' &&
    Number.isFinite(candidate.metadataQualityScore)
    ? candidate.metadataQualityScore
    : 0;
}

function parseCandidateGameId(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isResolvedStrongCoreSuffixTie(
  best: RankedTitleMatchCandidate,
  second: RankedTitleMatchCandidate | undefined
): boolean {
  if (!second) {
    return false;
  }
  if (
    best.coreScore < SUFFIX_RANK_STRONG_CORE_THRESHOLD ||
    second.coreScore < SUFFIX_RANK_STRONG_CORE_THRESHOLD
  ) {
    return false;
  }
  if (Math.abs(best.coreScore - second.coreScore) > TITLE_MATCH_MIN_GAP) {
    return false;
  }
  return best.suffixRank < second.suffixRank;
}

function isResolvedEquivalentStrongCoreTie(
  best: RankedTitleMatchCandidate,
  second: RankedTitleMatchCandidate | undefined
): boolean {
  if (!second) {
    return false;
  }
  if (
    best.coreScore < SUFFIX_RANK_STRONG_CORE_THRESHOLD ||
    second.coreScore < SUFFIX_RANK_STRONG_CORE_THRESHOLD
  ) {
    return false;
  }
  if (Math.abs(best.coreScore - second.coreScore) > TITLE_MATCH_MIN_GAP) {
    return false;
  }
  if (best.suffixRank !== second.suffixRank) {
    return false;
  }
  if (
    !isBaseOrStandardSuffixClass(best.suffixClass) ||
    !isBaseOrStandardSuffixClass(second.suffixClass)
  ) {
    return false;
  }

  const bestTitle = normalizeTitleForMatch(best.candidate.title ?? '');
  const secondTitle = normalizeTitleForMatch(second.candidate.title ?? '');
  if (!bestTitle || bestTitle === secondTitle) {
    return false;
  }

  return true;
}

function isBaseOrStandardSuffixClass(suffixClass: TitleSuffixClass): boolean {
  return suffixClass === 'base' || suffixClass === 'standard';
}

function isResolvedDuplicateTie(
  best: RankedTitleMatchCandidate,
  second: RankedTitleMatchCandidate | undefined
): boolean {
  if (!second || best.coreScore !== second.coreScore || best.suffixRank !== second.suffixRank) {
    return false;
  }

  const bestTitle = normalizeTitleForMatch(best.candidate.title ?? '');
  const secondTitle = normalizeTitleForMatch(second.candidate.title ?? '');
  if (!bestTitle || bestTitle !== secondTitle) {
    return false;
  }

  const bestQuality = resolveCandidateQualityScore(best.candidate);
  const secondQuality = resolveCandidateQualityScore(second.candidate);
  return bestQuality > secondQuality;
}

function normalizeTitleForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCoreTitleMatch(expectedTitle: string, candidateTitle: string): number {
  const expected = expectedTitle;
  const candidate = candidateTitle;
  if (!expected || !candidate) {
    return 0;
  }
  if (expected === candidate) {
    return 100;
  }

  let score = 0;
  if (expected.includes(candidate) || candidate.includes(expected)) {
    score += 20;
  }

  const expectedTokens = new Set(expected.split(' ').filter(Boolean));
  const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
  const overlap = [...expectedTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...expectedTokens, ...candidateTokens]).size;
  if (union > 0) {
    score += (overlap / union) * 80;
  }
  return score;
}

function compareRankedTitleMatchCandidates(
  left: RankedTitleMatchCandidate,
  right: RankedTitleMatchCandidate
): number {
  if (
    left.coreScore >= SUFFIX_RANK_STRONG_CORE_THRESHOLD &&
    right.coreScore >= SUFFIX_RANK_STRONG_CORE_THRESHOLD
  ) {
    const coreGap = Math.abs(left.coreScore - right.coreScore);
    if (coreGap > TITLE_MATCH_MIN_GAP) {
      return right.coreScore - left.coreScore;
    }
    if (left.suffixRank !== right.suffixRank) {
      return left.suffixRank - right.suffixRank;
    }
    const baseStandardOrder = compareEquivalentSuffixClass(left.suffixClass, right.suffixClass);
    if (baseStandardOrder !== 0) {
      return baseStandardOrder;
    }
    if (left.hasPlatformSuffix !== right.hasPlatformSuffix) {
      return left.hasPlatformSuffix ? 1 : -1;
    }
    if (left.hasContextPlatformSuffix !== right.hasContextPlatformSuffix) {
      return left.hasContextPlatformSuffix ? -1 : 1;
    }
  } else if (right.coreScore !== left.coreScore) {
    return right.coreScore - left.coreScore;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const rightQuality = resolveCandidateQualityScore(right.candidate);
  const leftQuality = resolveCandidateQualityScore(left.candidate);
  if (rightQuality !== leftQuality) {
    return rightQuality - leftQuality;
  }
  const rightHasPrice = right.candidate.amount !== null ? 1 : 0;
  const leftHasPrice = left.candidate.amount !== null ? 1 : 0;
  if (rightHasPrice !== leftHasPrice) {
    return rightHasPrice - leftHasPrice;
  }
  const rightId = parseCandidateGameId(right.candidate.gameId);
  const leftId = parseCandidateGameId(left.candidate.gameId);
  if (leftId !== rightId) {
    if (leftId === null) {
      return 1;
    }
    if (rightId === null) {
      return -1;
    }
    return leftId - rightId;
  }

  const urlOrder = compareNullableTieBreakStrings(left.candidate.url, right.candidate.url);
  if (urlOrder !== 0) {
    return urlOrder;
  }

  const titleOrder = compareNullableTieBreakStrings(left.candidate.title, right.candidate.title);
  if (titleOrder !== 0) {
    return titleOrder;
  }

  const rawGameIdOrder = compareNullableTieBreakStrings(
    left.candidate.gameId,
    right.candidate.gameId
  );
  if (rawGameIdOrder !== 0) {
    return rawGameIdOrder;
  }

  return 0;
}

function compareNullableTieBreakStrings(
  left: string | null | undefined,
  right: string | null | undefined
): number {
  if (left === right) {
    return 0;
  }

  const leftNormalized = normalizeTieBreakString(left);
  const rightNormalized = normalizeTieBreakString(right);
  const leftEmpty = leftNormalized.length === 0;
  const rightEmpty = rightNormalized.length === 0;
  if (leftEmpty && !rightEmpty) {
    return 1;
  }
  if (!leftEmpty && rightEmpty) {
    return -1;
  }
  if (leftNormalized < rightNormalized) {
    return -1;
  }
  if (leftNormalized > rightNormalized) {
    return 1;
  }
  return 0;
}

function normalizeTieBreakString(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return value.trim().toLowerCase();
}

function compareEquivalentSuffixClass(left: TitleSuffixClass, right: TitleSuffixClass): number {
  if (left === right) {
    return 0;
  }
  if (left === 'base' && right === 'standard') {
    return -1;
  }
  if (left === 'standard' && right === 'base') {
    return 1;
  }
  return 0;
}

function applySuffixShaping(args: {
  coreScore: number;
  suffixClass: TitleSuffixClass;
  strongCoreThreshold: number;
}): number {
  if (args.coreScore < args.strongCoreThreshold) {
    return args.coreScore;
  }

  const penaltyByClass: Record<TitleSuffixClass, number> = {
    base: 0,
    standard: 0,
    complete: 2,
    ultimate: 4,
    deluxe: 7,
    bundle: 10,
    expansion: 18,
    other: 12,
  };
  return Math.max(0, args.coreScore - penaltyByClass[args.suffixClass]);
}

function resolveSuffixRank(suffixClass: TitleSuffixClass): number {
  const rankByClass: Record<TitleSuffixClass, number> = {
    base: 0,
    standard: 0,
    complete: 1,
    ultimate: 2,
    deluxe: 3,
    bundle: 4,
    expansion: 5,
    other: 6,
  };
  return rankByClass[suffixClass];
}

function classifyTitleSuffixClass(value: string): TitleSuffixClass {
  const normalized = value.trim();
  if (!normalized) {
    return 'base';
  }

  const suffixInput = normalizeSuffixInspectionInput(normalized);
  const suffixSegment = suffixInput[suffixInput.length - 1] ?? normalized;
  const tail = normalized.split(' ').slice(-8).join(' ');
  const classifierInput = `${suffixSegment} ${tail}`.trim();

  if (hasSuffixPattern(classifierInput, SUFFIX_EXPANSION_PATTERNS)) {
    return 'expansion';
  }
  if (hasSuffixPattern(classifierInput, SUFFIX_BUNDLE_PATTERNS)) {
    return 'bundle';
  }
  if (hasSuffixPattern(classifierInput, SUFFIX_DELUXE_PATTERNS)) {
    return 'deluxe';
  }
  if (hasSuffixPattern(classifierInput, SUFFIX_ULTIMATE_PATTERNS)) {
    return 'ultimate';
  }
  if (hasSuffixPattern(classifierInput, SUFFIX_COMPLETE_PATTERNS)) {
    return 'complete';
  }
  if (hasSuffixPattern(classifierInput, SUFFIX_STANDARD_PATTERNS)) {
    return 'standard';
  }

  if (suffixInput.length <= 1) {
    return 'base';
  }

  return 'other';
}

function normalizeSuffixInspectionInput(value: string): string[] {
  const normalized = value.replace(/[—–]/g, '-').replace(/[:()]/g, '-').replace(/\s+/g, ' ').trim();

  const segments = normalized
    .split(/\s*-\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return [value];
  }
  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function hasSuffixPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizeSequelNumberToken(token: string): string {
  const arabic = parseArabicSequelNumberToken(token);
  if (arabic !== null) {
    return `seq_${String(arabic)}`;
  }

  const roman = parseRomanSequelNumberToken(token);
  if (roman !== null) {
    return `seq_${String(roman)}`;
  }

  return token;
}

function parseArabicSequelNumberToken(token: string): number | null {
  if (!/^\d+$/.test(token)) {
    return null;
  }

  const parsed = Number.parseInt(token, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SEQUEL_NUMBER_TOKEN) {
    return null;
  }

  return parsed;
}

function parseRomanSequelNumberToken(token: string): number | null {
  const roman = token.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(roman)) {
    return null;
  }

  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = ROMAN_NUMERAL_VALUES[roman[index]] ?? 0;
    const next = ROMAN_NUMERAL_VALUES[roman[index + 1] ?? ''] ?? 0;
    total += current < next ? -current : current;
  }

  if (total < 1 || total > MAX_SEQUEL_NUMBER_TOKEN) {
    return null;
  }

  const canonical = toRoman(total);
  return canonical === roman ? total : null;
}

function toRoman(value: number): string {
  let remaining = value;
  let result = '';
  for (const [numeric, symbol] of ROMAN_NUMERAL_SYMBOLS) {
    while (remaining >= numeric) {
      result += symbol;
      remaining -= numeric;
    }
  }
  return result;
}

function isLowSignalTitleToken(token: string): boolean {
  return token === 'the' || token === 'a' || token === 'an' || token === 'and' || token === 'of';
}

function isEditionClassifierToken(token: string): boolean {
  return (
    token === 'standard' ||
    token === 'edition' ||
    token === 'complete' ||
    token === 'ultimate' ||
    token === 'gold' ||
    token === 'goty' ||
    token === 'legendary' ||
    token === 'deluxe' ||
    token === 'digital' ||
    token === 'super' ||
    token === 'collection' ||
    token === 'bundle' ||
    token === 'expansion' ||
    token === 'dlc' ||
    token === 'add' ||
    token === 'on' ||
    token === 'addon' ||
    token === 'season' ||
    token === 'pass' ||
    token === 'story' ||
    token === 'pack' ||
    token === 'episode' ||
    token === 'chapter' ||
    token === 'erweiterungspaket' ||
    token === 'remastered' ||
    token === 'remake'
  );
}

function derivePlatformMarkerContext(platform: string | null | undefined): PlatformMarkerContext {
  const normalized = normalizeTitleForMatch(platform ?? '');
  if (normalized === 'ps4' || normalized === 'ps5' || normalized.includes('playstation')) {
    return 'playstation';
  }
  if (normalized === 'switch' || normalized === 'switch2' || normalized.includes('switch')) {
    return 'switch';
  }
  if (normalized.includes('xbox')) {
    return 'xbox';
  }
  return null;
}

function buildCoreTitleForScoring(
  value: string,
  platformContext: PlatformMarkerContext
): {
  coreTitle: string;
  suffixInspectionTitle: string;
  hasPlatformSuffix: boolean;
  hasContextPlatformSuffix: boolean;
} {
  const normalized = normalizeTitleForMatch(value);
  const platformStripped = stripPlatformSuffixFromNormalizedTitle(normalized, platformContext);
  const filteredTokens = platformStripped.coreTitle
    .split(' ')
    .filter((token) => token.length > 0)
    .map((token) => normalizeSequelNumberToken(token))
    .filter((token) => !isEditionClassifierToken(token))
    .filter((token) => !isLowSignalTitleToken(token));

  if (filteredTokens.length === 0) {
    return {
      coreTitle: platformStripped.coreTitle,
      suffixInspectionTitle: platformStripped.coreTitle,
      hasPlatformSuffix: platformStripped.hasPlatformSuffix,
      hasContextPlatformSuffix: platformStripped.hasContextPlatformSuffix,
    };
  }

  return {
    coreTitle: filteredTokens.join(' '),
    suffixInspectionTitle: platformStripped.coreTitle,
    hasPlatformSuffix: platformStripped.hasPlatformSuffix,
    hasContextPlatformSuffix: platformStripped.hasContextPlatformSuffix,
  };
}

function stripPlatformSuffixFromNormalizedTitle(
  normalizedTitle: string,
  platformContext: PlatformMarkerContext
): { coreTitle: string; hasPlatformSuffix: boolean; hasContextPlatformSuffix: boolean } {
  if (!normalizedTitle || platformContext === null) {
    return {
      coreTitle: normalizedTitle,
      hasPlatformSuffix: false,
      hasContextPlatformSuffix: false,
    };
  }

  const contextPatterns = resolveContextPlatformSuffixPatterns(platformContext);
  const patterns = resolvePlatformSuffixPatterns(platformContext);
  let candidate = normalizedTitle;
  let removedAny = false;
  let removedContext = false;
  for (let i = 0; i < 2; i += 1) {
    const before = candidate;
    for (const pattern of patterns) {
      const updated = candidate.replace(pattern, '').replace(/\s+/g, ' ').trim();
      if (updated !== candidate && contextPatterns.includes(pattern)) {
        removedContext = true;
      }
      candidate = updated;
    }
    if (candidate === before) {
      break;
    }
    removedAny = true;
  }
  return {
    coreTitle: candidate,
    hasPlatformSuffix: removedAny,
    hasContextPlatformSuffix: removedContext,
  };
}

function buildPlatformSuffixBeforeQualifierPattern(platformFragment: string): RegExp {
  return new RegExp(
    `\\b(?:${platformFragment})(?: edition)?(?=\\s+${PLATFORM_TRAILING_QUALIFIER_FRAGMENT}(?:\\s+${PLATFORM_TRAILING_QUALIFIER_FRAGMENT})*$)`
  );
}

function resolvePlatformSuffixPatterns(platformContext: PlatformMarkerContext): RegExp[] {
  const allPatterns = [
    ...PLAYSTATION_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
    ...SWITCH_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
    ...XBOX_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
    ...PLAYSTATION_SUFFIX_PATTERNS,
    ...SWITCH_SUFFIX_PATTERNS,
    ...XBOX_SUFFIX_PATTERNS,
  ];

  if (platformContext === 'playstation') {
    return [
      ...PLAYSTATION_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...SWITCH_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...XBOX_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...PLAYSTATION_SUFFIX_PATTERNS,
      ...SWITCH_SUFFIX_PATTERNS,
      ...XBOX_SUFFIX_PATTERNS,
    ];
  }
  if (platformContext === 'switch') {
    return [
      ...SWITCH_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...PLAYSTATION_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...XBOX_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...SWITCH_SUFFIX_PATTERNS,
      ...PLAYSTATION_SUFFIX_PATTERNS,
      ...XBOX_SUFFIX_PATTERNS,
    ];
  }
  if (platformContext === 'xbox') {
    return [
      ...XBOX_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...PLAYSTATION_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...SWITCH_SUFFIX_BEFORE_QUALIFIER_PATTERNS,
      ...XBOX_SUFFIX_PATTERNS,
      ...PLAYSTATION_SUFFIX_PATTERNS,
      ...SWITCH_SUFFIX_PATTERNS,
    ];
  }
  return allPatterns;
}

function resolveContextPlatformSuffixPatterns(platformContext: PlatformMarkerContext): RegExp[] {
  if (platformContext === 'playstation') {
    return [...PLAYSTATION_SUFFIX_BEFORE_QUALIFIER_PATTERNS, ...PLAYSTATION_SUFFIX_PATTERNS];
  }
  if (platformContext === 'switch') {
    return [...SWITCH_SUFFIX_BEFORE_QUALIFIER_PATTERNS, ...SWITCH_SUFFIX_PATTERNS];
  }
  if (platformContext === 'xbox') {
    return [...XBOX_SUFFIX_BEFORE_QUALIFIER_PATTERNS, ...XBOX_SUFFIX_PATTERNS];
  }
  return [];
}
