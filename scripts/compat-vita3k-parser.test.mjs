import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchList,
  parseLabelNames,
  resolveStatusLabel,
} from '../compat-scraper/src/parsers/vita3k.mjs';

function encodeLabels(...names) {
  return JSON.stringify(names.map((name) => ({ name, color: '0E8A16' })));
}

async function fetchListWith(response) {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = (url) => {
    requestedUrls.push(String(url));
    return Promise.resolve(response());
  };

  try {
    return { entries: await fetchList(null, { timeoutMs: 1000 }), requestedUrls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function listResponse(list) {
  return () => Response.json({ date: 1791592562, list });
}

test('parseLabelNames reads JSON-encoded and array label lists', () => {
  assert.deepEqual(parseLabelNames(encodeLabels('Playable', 'gamemaker')), [
    'Playable',
    'gamemaker',
  ]);
  assert.deepEqual(parseLabelNames([{ name: ' Ingame + ' }, 'crash', { name: '' }, null, 7]), [
    'Ingame +',
    'crash',
  ]);
});

test('parseLabelNames returns no labels for malformed or unexpected input', () => {
  assert.deepEqual(parseLabelNames('[{"name":"Playable"'), []);
  assert.deepEqual(parseLabelNames('"Playable"'), []);
  assert.deepEqual(parseLabelNames(undefined), []);
  assert.deepEqual(parseLabelNames({ name: 'Playable' }), []);
});

test('resolveStatusLabel picks the status out of mixed labels, case-insensitively', () => {
  assert.equal(resolveStatusLabel(['graphics bug', 'Playable', 'unity']), 'Playable');
  assert.equal(resolveStatusLabel(['ingame -', 'crash']), 'Ingame -');
  assert.equal(resolveStatusLabel(['graphics bug', 'crash']), '');
  assert.equal(resolveStatusLabel([]), '');
});

test('resolveStatusLabel takes the worst status when several are present', () => {
  assert.equal(resolveStatusLabel(['Playable', 'Intro']), 'Intro');
  assert.equal(resolveStatusLabel(['Ingame -', 'Ingame +']), 'Ingame -');
  assert.equal(resolveStatusLabel(['Bootable', 'Menu']), 'Bootable');
});

test('fetchList maps entries from the api.vita3k.org labels shape and drops unlabelled ones', async () => {
  const { entries, requestedUrls } = await fetchListWith(
    listResponse([
      { name: ' VVVVVV ', titleId: 'PCSB00810', labels: encodeLabels('Playable'), issueId: 1 },
      {
        name: 'Downwell',
        titleId: 'PCSB00952',
        labels: encodeLabels('Playable', 'gamemaker'),
        issueId: 3,
      },
      {
        name: 'Killzone Mercenary',
        titleId: 'PCSF00243',
        labels: [{ name: 'Bootable' }, { name: 'Menu' }],
        issueId: 9,
      },
      {
        name: 'Soul Sacrifice Delta',
        titleId: 'PCSA00126',
        labels: encodeLabels('Playable', 'Intro'),
        issueId: 12,
      },
      { name: 'Untagged', titleId: 7, labels: encodeLabels('crash') },
      { name: 'Broken Labels', titleId: 'PCSE00001', labels: '[{', issueId: 20 },
      { name: '   ', titleId: 'PCSE00002', labels: encodeLabels('Playable'), issueId: 21 },
      null,
    ])
  );

  assert.deepEqual(requestedUrls, ['https://api.vita3k.org/list/commercial']);
  assert.deepEqual(entries, [
    {
      rawTitle: 'VVVVVV',
      rawLabel: 'Playable',
      normalizedStatus: 'playable',
      sourceId: 'PCSB00810',
      sourceUrl: 'https://github.com/Vita3K/compatibility/issues/1',
    },
    {
      rawTitle: 'Downwell',
      rawLabel: 'Playable',
      normalizedStatus: 'playable',
      sourceId: 'PCSB00952',
      sourceUrl: 'https://github.com/Vita3K/compatibility/issues/3',
    },
    {
      rawTitle: 'Killzone Mercenary',
      rawLabel: 'Bootable',
      normalizedStatus: 'incomplete',
      sourceId: 'PCSF00243',
      sourceUrl: 'https://github.com/Vita3K/compatibility/issues/9',
    },
    {
      rawTitle: 'Soul Sacrifice Delta',
      rawLabel: 'Intro',
      normalizedStatus: 'incomplete',
      sourceId: 'PCSA00126',
      sourceUrl: 'https://github.com/Vita3K/compatibility/issues/12',
    },
  ]);
  // "Untagged" and "Broken Labels" carry no recognised status and are dropped.
  assert.equal(
    entries.some((entry) => entry.rawLabel.length === 0),
    false
  );
});

test('fetchList returns an empty list as-is', async () => {
  const { entries } = await fetchListWith(listResponse([]));
  assert.deepEqual(entries, []);
});

test('fetchList rejects when no entry has a recognisable status label', async () => {
  await assert.rejects(
    fetchListWith(
      listResponse([
        { name: 'VVVVVV', titleId: 'PCSB00810', status: 'Playable', issueId: 1 },
        { name: 'Downwell', titleId: 'PCSB00952', status: 'Playable', issueId: 3 },
      ])
    ),
    /no recognisable status labels/
  );
});

test('fetchList rejects a non-OK response', async () => {
  await assert.rejects(
    fetchListWith(() => new Response('nope', { status: 503 })),
    /failed with status 503/
  );
});

test('fetchList rejects a response without a list array', async () => {
  await assert.rejects(
    fetchListWith(() => Response.json('invalid list')),
    /had no "list" array/
  );
});
