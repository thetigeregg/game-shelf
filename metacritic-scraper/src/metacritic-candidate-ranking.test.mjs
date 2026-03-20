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

test('rankCandidate favors a base game over Witcher 3 DLC and quest add-ons', () => {
  const expectedTitle = 'witcher 3';

  const baseCandidate = {
    title: 'The Witcher 3: Wild Hunt',
    releaseYear: 2015,
    platform: 'PlayStation 4',
    metacriticScore: 92,
  };
  const dlcCandidate = {
    title: 'The Witcher 3: Wild Hunt - Blood and Wine',
    releaseYear: 2016,
    platform: 'PC',
    metacriticScore: 92,
  };
  const questCandidate = {
    title: "The Witcher 3: Wild Hunt - New Quest: 'Fool's Gold'",
    releaseYear: 2015,
    platform: 'PC',
    metacriticScore: null,
  };

  const baseScore = rankCandidate(expectedTitle, null, null, null, baseCandidate);
  const dlcScore = rankCandidate(expectedTitle, null, null, null, dlcCandidate);
  const questScore = rankCandidate(expectedTitle, null, null, null, questCandidate);

  assert.ok(baseScore > dlcScore);
  assert.ok(baseScore > questScore);
});

test('rankCandidate supports acronym-style GTA queries', () => {
  const exactCandidate = {
    title: 'Grand Theft Auto V',
    releaseYear: 2014,
    platform: 'PlayStation 4',
    metacriticScore: 97,
  };
  const weakerCandidate = {
    title: 'Grand Theft Auto: Vice City',
    releaseYear: 2002,
    platform: 'PlayStation 2',
    metacriticScore: 95,
  };

  const gtavExactScore = rankCandidate('gtav', null, null, null, exactCandidate);
  const gtavWeakerScore = rankCandidate('gtav', null, null, null, weakerCandidate);
  const gtaVExactScore = rankCandidate('gta v', null, null, null, exactCandidate);
  const gtaVWeakerScore = rankCandidate('gta v', null, null, null, weakerCandidate);

  assert.ok(gtavExactScore > gtavWeakerScore);
  assert.ok(gtaVExactScore > gtaVWeakerScore);
  assert.ok(gtavExactScore >= 115);
  assert.ok(gtaVExactScore >= 40);
});

test('rankCandidate matches against any retained Metacritic platform alias', () => {
  const multiPlatformCandidate = {
    title: 'The Elder Scrolls V: Skyrim',
    releaseYear: 2011,
    platform: 'Xbox 360',
    metacriticPlatforms: ['Xbox 360', 'PlayStation 3', 'PC'],
    metacriticScore: 96,
  };
  const singlePlatformCandidate = {
    title: 'The Elder Scrolls V: Skyrim',
    releaseYear: 2011,
    platform: 'Xbox 360',
    metacriticScore: 96,
  };

  const multiPlatformScore = rankCandidate(
    'The Elder Scrolls V: Skyrim',
    2011,
    'PC',
    null,
    multiPlatformCandidate
  );
  const singlePlatformScore = rankCandidate(
    'The Elder Scrolls V: Skyrim',
    2011,
    'PC',
    null,
    singlePlatformCandidate
  );

  assert.ok(multiPlatformScore > singlePlatformScore);
});
