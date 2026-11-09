import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNintendoEshopGameUrl,
  escapeSolrTerm,
  fetchNintendoEshopGameByNsuid,
  fetchNintendoEshopPrices,
  parseNintendoEshopNsuid,
  searchNintendoEshopGames,
} from './nintendo-eshop-client.js';
import type { ProviderLimiter } from './provider-rate-limit.js';

const LOCALE = { country: 'CH', language: 'de' };

/** Lets every request through at once, so tests don't wait on the real limiter's spacing. */
const openLimiter = {
  acquire: () => Promise.resolve({ delayMs: 0, scopeKey: 'test', release: () => undefined }),
  consumeRateLimitHeaders: () => 0,
} as unknown as ProviderLimiter;

function fakeFetch(respond: (url: URL) => { status: number; body: unknown }) {
  const requests: URL[] = [];
  const fetchImpl = (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    const { status, body } = respond(url);
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    );
  };
  const typedFetch: typeof fetch = fetchImpl;
  return { fetchImpl: typedFetch, requests };
}

function options(fetchImpl: typeof fetch) {
  return {
    locale: LOCALE,
    fetchImpl,
    searchBaseUrl: 'https://search.example',
    priceApiBaseUrl: 'https://price.example',
    limiter: openLimiter,
    timeoutMs: 1000,
  };
}

// Trimmed from real search replies for "Hades II" (Switch, then Switch 2).
const hadesSearchDocs = [
  {
    title: 'Hades II',
    nsuid_txt: ['70010000060676'],
    playable_on_txt: ['HAC'],
    image_url_sq_s: 'https://image.example/hades2.jpg',
    eshop_removed_b: false,
  },
  {
    title: 'Hades II – Nintendo Switch 2 Edition',
    // The upgrade pack (7005…) is listed first; the game is the 7001… nsuid.
    nsuid_txt: ['70050000062085', '70010000106342'],
    playable_on_txt: ['BEE'],
  },
  { title: 'Hades', nsuid_txt: ['70010000033132'], playable_on_txt: ['HAC'] },
  // A co-op game that also lists its free Friend's Pass as a game.
  {
    title: 'SPLIT FICTION',
    nsuid_txt: ['70010000097435', '70010000095423'],
    playable_on_txt: ['BEE'],
  },
  // A retail-only game has no nsuid, and a removed one isn't sold any more.
  { title: 'Hades Boxed Edition', playable_on_txt: ['HAC'] },
  {
    title: 'Hades Delisted',
    nsuid_txt: ['70010000099999'],
    playable_on_txt: ['HAC'],
    eshop_removed_b: true,
  },
];

void test('searchNintendoEshopGames queries the English index for the platform', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({
    status: 200,
    body: { response: { numFound: 0, docs: [] } },
  }));
  await searchNintendoEshopGames('Zelda: Breath of the Wild', 'HAC', {
    ...options(fetchImpl),
    rows: 30,
  });

  const url = requests[0];
  assert.equal(url.origin + url.pathname, 'https://search.example/en/select');
  assert.equal(url.searchParams.get('q'), 'zelda\\: breath of the wild');
  assert.equal(url.searchParams.get('fq'), 'type:GAME AND playable_on_txt:HAC');
  assert.equal(url.searchParams.get('rows'), '30');
  assert.equal(url.searchParams.get('wt'), 'json');
  assert.match(url.searchParams.get('fl') ?? '', /nsuid_txt/);
});

void test('searchNintendoEshopGames keeps games sold digitally, by their own nsuid', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    status: 200,
    body: { response: { docs: hadesSearchDocs } },
  }));
  const games = await searchNintendoEshopGames('Hades II', 'HAC', options(fetchImpl));

  assert.deepEqual(games, [
    {
      nsuid: '70010000060676',
      gameNsuids: ['70010000060676'],
      title: 'Hades II',
      platformCodes: ['HAC'],
      imageUrl: 'https://image.example/hades2.jpg',
    },
    {
      nsuid: '70010000106342',
      gameNsuids: ['70010000106342'],
      title: 'Hades II – Nintendo Switch 2 Edition',
      platformCodes: ['BEE'],
      imageUrl: null,
    },
    {
      nsuid: '70010000033132',
      gameNsuids: ['70010000033132'],
      title: 'Hades',
      platformCodes: ['HAC'],
      imageUrl: null,
    },
    {
      nsuid: '70010000097435',
      gameNsuids: ['70010000097435', '70010000095423'],
      title: 'SPLIT FICTION',
      platformCodes: ['BEE'],
      imageUrl: null,
    },
  ]);
});

void test('a search reply without a results list is a failure, not "no matches"', async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 200, body: { error: 'boom' } }));
  await assert.rejects(
    searchNintendoEshopGames('Hades', 'HAC', options(fetchImpl)),
    /search returned no results list/
  );
});

void test('fetchNintendoEshopGameByNsuid looks the game up by nsuid', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({
    status: 200,
    body: { response: { docs: [hadesSearchDocs[0]] } },
  }));
  const game = await fetchNintendoEshopGameByNsuid('70010000060676', options(fetchImpl));

  assert.equal(game?.title, 'Hades II');
  assert.equal(requests[0].searchParams.get('fq'), 'type:GAME AND nsuid_txt:70010000060676');
  assert.equal(requests[0].searchParams.get('rows'), '1');
});

// Trimmed from real price replies for the Swiss eShop.
const priceReply = {
  personalized: false,
  country: 'CH',
  prices: [
    {
      title_id: 70010000060676,
      sales_status: 'onsale',
      regular_price: { amount: 'CHF 32.50', currency: 'CHF', raw_value: '32.5' },
    },
    {
      title_id: 70010000003401,
      sales_status: 'onsale',
      regular_price: { amount: 'CHF 35.00', currency: 'CHF', raw_value: '35' },
      discount_price: {
        amount: 'CHF 8.75',
        currency: 'CHF',
        raw_value: '8.75',
        start_datetime: '2026-10-27T23:00:00Z',
        end_datetime: '2026-11-25T22:59:59Z',
      },
    },
    {
      title_id: 70010000010190,
      sales_status: 'onsale',
      regular_price: { amount: 'CHF 0.00', currency: 'CHF', raw_value: '0' },
    },
    {
      title_id: 70010000102603,
      sales_status: 'preorder',
      is_download_ready: false,
      regular_price: { amount: 'CHF 39.90', currency: 'CHF', raw_value: '39.9' },
    },
    { title_id: 70010000134217, sales_status: 'unreleased' },
    {
      title_id: 70010000025391,
      sales_status: 'not_found',
      regular_price: { amount: 'CHF 42.00', currency: 'CHF', raw_value: '42' },
    },
  ],
};

void test('fetchNintendoEshopPrices reads regular, sale, free and pre-order prices', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({ status: 200, body: priceReply }));
  const prices = await fetchNintendoEshopPrices(
    [
      '70010000060676',
      '70010000003401',
      '70010000010190',
      '70010000102603',
      '70010000134217',
      '70010000025391',
    ],
    options(fetchImpl)
  );

  const url = requests[0];
  assert.equal(url.origin + url.pathname, 'https://price.example/v1/price');
  assert.equal(url.searchParams.get('country'), 'CH');
  assert.equal(url.searchParams.get('lang'), 'de');
  assert.deepEqual(prices.get('70010000060676'), {
    nsuid: '70010000060676',
    amount: 32.5,
    regularAmount: 32.5,
    currency: 'CHF',
    discountPercent: 0,
    isFree: false,
    saleEndsAt: null,
  });
  assert.deepEqual(prices.get('70010000003401'), {
    nsuid: '70010000003401',
    amount: 8.75,
    regularAmount: 35,
    currency: 'CHF',
    discountPercent: 75,
    isFree: false,
    saleEndsAt: '2026-11-25T22:59:59.000Z',
  });
  assert.equal(prices.get('70010000010190')?.isFree, true);
  assert.equal(prices.get('70010000102603')?.amount, 39.9);
  // Not for sale in this country: no price.
  assert.equal(prices.has('70010000134217'), false);
  assert.equal(prices.has('70010000025391'), false);
});

void test('fetchNintendoEshopPrices batches 50 nsuids per request and skips invalid ones', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({ status: 200, body: { prices: [] } }));
  const nsuids = Array.from({ length: 60 }, (_, index) => String(70010000000000 + index));
  await fetchNintendoEshopPrices([...nsuids, nsuids[0], 'nope'], options(fetchImpl));

  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('ids')?.split(',').length, 50);
  assert.equal(requests[1].searchParams.get('ids')?.split(',').length, 10);

  const none = fakeFetch(() => ({ status: 200, body: { prices: [] } }));
  assert.equal((await fetchNintendoEshopPrices([], options(none.fetchImpl))).size, 0);
  assert.equal(none.requests.length, 0);
});

void test('a price reply without a price list, or an error status, is a failure', async () => {
  const noList = fakeFetch(() => ({ status: 200, body: { country: 'CH' } }));
  await assert.rejects(
    fetchNintendoEshopPrices(['70010000060676'], options(noList.fetchImpl)),
    /returned no price list/
  );
  const badRequest = fakeFetch(() => ({ status: 400, body: { error: { code: 4000 } } }));
  await assert.rejects(
    fetchNintendoEshopPrices(['70010000060676'], options(badRequest.fetchImpl)),
    /price request failed with status 400/
  );
  const notJson = fakeFetch(() => ({ status: 200, body: '<html>' }));
  await assert.rejects(
    fetchNintendoEshopPrices(['70010000060676'], options(notJson.fetchImpl)),
    /non-JSON reply/
  );
});

void test('parseNintendoEshopNsuid accepts an nsuid, an eShop link or a redirected game page', () => {
  assert.equal(parseNintendoEshopNsuid('70010000060676'), '70010000060676');
  assert.equal(parseNintendoEshopNsuid(' 70010000060676 '), '70010000060676');
  assert.equal(parseNintendoEshopNsuid(70010000060676), '70010000060676');
  assert.equal(
    parseNintendoEshopNsuid('https://ec.nintendo.com/CH/de/titles/70010000060676'),
    '70010000060676'
  );
  assert.equal(
    parseNintendoEshopNsuid(
      'https://www.nintendo.com/de-ch/Spiele/Nintendo-Switch-Download-Software/Hades-II-2914566.html?nsuid=70010000060676'
    ),
    '70010000060676'
  );
  assert.equal(parseNintendoEshopNsuid('12345'), null);
  // An upgrade pack's or bundle's price isn't the game's.
  assert.equal(parseNintendoEshopNsuid('70050000062085'), null);
  assert.equal(
    parseNintendoEshopNsuid('https://ec.nintendo.com/CH/de/titles/70070000030750'),
    null
  );
  assert.equal(parseNintendoEshopNsuid('https://example.com/titles/70010000060676'), null);
  assert.equal(parseNintendoEshopNsuid('https://www.nintendo.com/de-ch/Hades-II.html'), null);
  assert.equal(parseNintendoEshopNsuid(null), null);
});

void test('buildNintendoEshopGameUrl builds the eShop link for the store country', () => {
  assert.equal(
    buildNintendoEshopGameUrl('70010000060676', LOCALE),
    'https://ec.nintendo.com/CH/de/titles/70010000060676'
  );
});

void test('escapeSolrTerm escapes query syntax so titles search as text', () => {
  assert.equal(
    escapeSolrTerm('mario + rabbids: (deluxe)!'),
    'mario \\+ rabbids\\: \\(deluxe\\)\\!'
  );
  assert.equal(escapeSolrTerm('hades ii'), 'hades ii');
});
