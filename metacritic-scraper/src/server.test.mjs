import assert from 'node:assert/strict';
import test from 'node:test';
import { rankCandidate } from './server.mjs';

test('rankCandidate favors ordered subtitle token matches over unrelated fury titles', () => {
  const expectedTitle = 'bowser fury';
  const expectedYear = 2021;
  const expectedPlatform = 'Nintendo Switch';

  const bowserCandidate = {
    title: "Super Mario 3D World + Bowser's Fury",
    releaseYear: 2021,
    platform: 'Nintendo Switch',
    metacriticScore: 89,
  };
  const unrelatedCandidate = {
    title: 'Fury Unleashed',
    releaseYear: 2020,
    platform: 'Nintendo Switch',
    metacriticScore: 76,
  };

  const bowserScore = rankCandidate(
    expectedTitle,
    expectedYear,
    expectedPlatform,
    null,
    bowserCandidate
  );
  const unrelatedScore = rankCandidate(
    expectedTitle,
    expectedYear,
    expectedPlatform,
    null,
    unrelatedCandidate
  );

  assert.ok(bowserScore > unrelatedScore);
  assert.ok(bowserScore >= 115);
});
