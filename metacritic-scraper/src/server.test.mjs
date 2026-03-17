import assert from 'node:assert/strict';
import test from 'node:test';
import { rankCandidate } from './metacritic-candidate-ranking.mjs';

test('rankCandidate favors exact title, year, and platform matches over weaker candidates', () => {
  const expectedTitle = "Super Mario 3D World + Bowser's Fury";
  const expectedYear = 2021;
  const expectedPlatform = 'Nintendo Switch';

  const exactCandidate = {
    title: "Super Mario 3D World + Bowser's Fury",
    releaseYear: 2021,
    platform: 'Nintendo Switch',
    metacriticScore: 89,
  };
  const weakerCandidate = {
    title: 'Fury Unleashed',
    releaseYear: 2020,
    platform: 'Nintendo Switch',
    metacriticScore: 76,
  };

  const exactScore = rankCandidate(
    expectedTitle,
    expectedYear,
    expectedPlatform,
    null,
    exactCandidate
  );
  const weakerScore = rankCandidate(
    expectedTitle,
    expectedYear,
    expectedPlatform,
    null,
    weakerCandidate
  );

  assert.ok(exactScore > weakerScore);
});
