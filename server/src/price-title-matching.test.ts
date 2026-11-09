import assert from 'node:assert/strict';
import test from 'node:test';
import { matchCandidatesByTitle, type TitleMatchCandidate } from './price-title-matching.js';

function candidate(
  title: string,
  overrides: Partial<TitleMatchCandidate> = {}
): TitleMatchCandidate {
  return {
    title,
    url: `https://store.example/${encodeURIComponent(title)}`,
    amount: 29.9,
    ...overrides,
  };
}

function titles(candidates: Array<{ title: string | null }>): Array<string | null> {
  return candidates.map((entry) => entry.title);
}

void test('matchCandidatesByTitle reports no match for no candidates', () => {
  assert.deepEqual(matchCandidatesByTitle('Hades II', 'PS5', []), {
    best: null,
    match: { queryTitle: 'Hades II', matchedTitle: null, score: null, confidence: 'none' },
    candidates: [],
  });
});

void test('matchCandidatesByTitle matches an exact title with high confidence', () => {
  const result = matchCandidatesByTitle('Hades II', 'PS5', [
    candidate('Hades'),
    candidate('Hades II'),
    candidate('WO4U: Special Costume for Hades'),
  ]);
  assert.equal(result.best?.title, 'Hades II');
  assert.deepEqual(result.match, {
    queryTitle: 'Hades II',
    matchedTitle: 'Hades II',
    score: 100,
    confidence: 'high',
  });
  assert.equal(result.candidates[0].title, 'Hades II');
});

void test('matchCandidatesByTitle treats roman and arabic sequel numerals as equal', () => {
  const result = matchCandidatesByTitle('Hades 2', 'PS5', [
    candidate('Hades'),
    candidate('Hades II'),
  ]);
  assert.equal(result.best?.title, 'Hades II');
  assert.equal(result.match.confidence, 'high');
});

void test('matchCandidatesByTitle ignores a trailing platform suffix on the candidate', () => {
  const result = matchCandidatesByTitle('Astro Bot', 'PS5', [candidate('Astro Bot PS5')]);
  assert.equal(result.best?.title, 'Astro Bot PS5');
  assert.equal(result.match.confidence, 'high');
});

void test('matchCandidatesByTitle prefers the base game over its editions and add-ons', () => {
  const result = matchCandidatesByTitle('Astro Bot', 'PS5', [
    candidate('Astro Bot Digital Deluxe Edition'),
    candidate('Astro Bot Digital Deluxe Edition Upgrade'),
    candidate('Astro Bot'),
  ]);
  assert.equal(result.best?.title, 'Astro Bot');
  assert.equal(result.match.confidence, 'high');
  assert.deepEqual(titles(result.candidates), [
    'Astro Bot',
    'Astro Bot Digital Deluxe Edition',
    'Astro Bot Digital Deluxe Edition Upgrade',
  ]);
  // Edition words drop out of the core title, so the deluxe edition is the same game less a
  // 7-point deluxe penalty. "Upgrade" stays in the core title, so that one is a weaker title match.
  const [base, deluxe, upgrade] = result.candidates.map((entry) => entry.score);
  assert.equal(base, 100);
  assert.equal(deluxe, 93);
  assert.ok(upgrade < 70, `upgrade score ${String(upgrade)}`);
});

void test('matchCandidatesByTitle returns no match when two different games are equally close', () => {
  const result = matchCandidatesByTitle('Ratchet Clank', 'PS5', [
    candidate('Ratchet & Clank: Rift Apart'),
    candidate('Ratchet & Clank: Into the Nexus'),
  ]);
  assert.equal(result.best, null);
  assert.equal(result.match.confidence, 'low');
  assert.equal(result.candidates.length, 2);
});

void test('matchCandidatesByTitle returns no match for a weak best score', () => {
  const result = matchCandidatesByTitle('Hades II', 'PS5', [
    candidate('Assassin’s Creed Odyssey EP2.2: Torment of Hades'),
  ]);
  assert.equal(result.best, null);
  assert.equal(result.match.confidence, 'low');
  assert.equal(result.match.matchedTitle, 'Assassin’s Creed Odyssey EP2.2: Torment of Hades');
});

void test('matchCandidatesByTitle lets a preferred candidate win outright', () => {
  const pinned = candidate('Hades', { url: 'https://store.example/pinned' });
  const result = matchCandidatesByTitle('Hades II', 'PS5', [candidate('Hades II'), pinned], {
    isPreferred: (entry) => entry.url === 'https://store.example/pinned',
  });
  assert.equal(result.best, pinned);
  assert.equal(result.match.confidence, 'high');
  assert.equal(result.match.matchedTitle, 'Hades');
  // The ranking itself is unchanged.
  assert.equal(result.candidates[0].title, 'Hades II');
});

void test('matchCandidatesByTitle falls back to normal ranking when no candidate is preferred', () => {
  const result = matchCandidatesByTitle('Hades II', 'PS5', [candidate('Hades II')], {
    isPreferred: () => false,
  });
  assert.equal(result.best?.title, 'Hades II');
});

void test('matchCandidatesByTitle breaks an identical-title tie by metadata quality', () => {
  const result = matchCandidatesByTitle('Hades II', 'PS5', [
    candidate('Hades II', { url: 'https://store.example/a', metadataQualityScore: 2 }),
    candidate('Hades II', { url: 'https://store.example/b', metadataQualityScore: 8 }),
  ]);
  assert.equal(result.best?.url, 'https://store.example/b');
  assert.equal(result.match.confidence, 'high');
});

void test('matchCandidatesByTitle keeps the candidate type and limits the ranked list', () => {
  interface StoreCandidate extends TitleMatchCandidate {
    productId: string;
  }
  const many: StoreCandidate[] = Array.from({ length: 5 }, (_, index) => ({
    ...candidate(`Game ${String(index + 1)}`),
    productId: `P${String(index + 1)}`,
  }));
  const result = matchCandidatesByTitle('Game 3', 'PS5', many, { maxCandidates: 2 });
  assert.equal(result.best?.productId, 'P3');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].productId, 'P3');
});
