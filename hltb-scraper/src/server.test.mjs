import assert from 'node:assert/strict';
import test from 'node:test';
import { __testables } from './server.mjs';

const { findBestMatch, normalizeEntry, rankCandidateEntries } = __testables;

void test('normalizeEntry preserves co-op-only multiplayer timings', () => {
  const normalized = normalizeEntry({
    game_name: 'Project: Gorgon',
    game_id: 58476,
    game_url: '/game/58476',
    invested_co: 56 * 3600,
  });

  assert.ok(normalized);
  assert.equal(normalized.hltbGameId, 58476);
  assert.equal(normalized.hltbUrl, 'https://howlongtobeat.com/game/58476');
  assert.equal(normalized.coOp, 56);
  assert.equal(normalized.hltbMainHours, 56);
  assert.equal(normalized.hltbMainExtraHours, null);
  assert.equal(normalized.hltbCompletionistHours, null);
});

void test('normalizeEntry preserves versus-only multiplayer timings', () => {
  const normalized = normalizeEntry({
    game_name: 'MapleStory Duel',
    game_id: 90001,
    invested_mp: 9 * 3600,
  });

  assert.ok(normalized);
  assert.equal(normalized.vs, 9);
  assert.equal(normalized.hltbMainHours, 9);
});

void test('rankCandidateEntries and findBestMatch use multiplayer-only timings', () => {
  const entries = [
    {
      game_name: 'Project: Gorgon',
      game_id: 58476,
      game_url: '/game/58476',
      profile_platform: 'PC',
      release_world: 2018,
      invested_co: 56 * 3600,
    },
  ];

  const ranked = rankCandidateEntries(entries, 'Project: Gorgon', 2018, 'pc');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.coOp, 56);
  assert.equal(ranked[0]?.hltbMainHours, 56);

  const best = findBestMatch(entries, 'Project: Gorgon', 2018, 'PC');
  assert.deepEqual(best, {
    hltbMainHours: 56,
    hltbMainExtraHours: null,
    hltbCompletionistHours: null,
    hltbGameId: 58476,
    hltbUrl: 'https://howlongtobeat.com/game/58476',
  });
});
