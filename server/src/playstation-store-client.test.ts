import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAYSTATION_STORE_PRODUCT_PRICE_QUERY_HASH,
  PLAYSTATION_STORE_SEARCH_QUERY_HASH,
  PlayStationStoreQueryRejectedError,
  buildPlayStationStoreProductUrl,
  fetchPlayStationStoreProductPrice,
  parsePlayStationStoreDiscountPercent,
  parsePlayStationStoreDisplayCurrency,
  parsePlayStationStoreDisplayPrice,
  parsePlayStationStoreProductId,
  searchPlayStationStoreProducts,
} from './playstation-store-client.js';
import type { ProviderLimiter } from './provider-rate-limit.js';

const LOCALE = { country: 'CH', language: 'de' };
const BASE_URL = 'https://store.example';

/** Lets every request through at once, so tests don't wait on the real limiter's spacing. */
const openLimiter = {
  acquire: () => Promise.resolve({ delayMs: 0, scopeKey: 'test', release: () => undefined }),
  consumeRateLimitHeaders: () => 0,
} as unknown as ProviderLimiter;

interface RecordedRequest {
  url: URL;
  headers: Record<string, string>;
}

function fakeFetch(status: number, body: unknown) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: new URL(input instanceof Request ? input.url : String(input)),
      headers: init?.headers as Record<string, string>,
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  const typedFetch: typeof fetch = fetchImpl;
  return { fetchImpl: typedFetch, requests };
}

function options(fetchImpl: typeof fetch) {
  return { locale: LOCALE, fetchImpl, baseUrl: BASE_URL, limiter: openLimiter, timeoutMs: 1000 };
}

// Trimmed from a real getSearchResults reply for "Astro Bot" in de-CH.
const searchReply = {
  data: {
    universalSearch: {
      results: [
        {
          __typename: 'Product',
          id: 'EP9000-CUSA13560_00-PFVRDEMO000000EU',
          name: 'ASTRO BOT: Rettungseinsatz™-Demo',
          platforms: ['PS4'],
          storeDisplayClassification: 'DEMO',
          price: {
            basePrice: 'Kostenlos',
            discountedPrice: 'Kostenlos',
            discountText: null,
            isFree: true,
          },
          media: [],
        },
        {
          __typename: 'Product',
          id: 'EP9000-PPSA21567_00-0000000000000000',
          name: 'ASTRO BOT',
          platforms: ['PS5'],
          storeDisplayClassification: 'FULL_GAME',
          price: {
            basePrice: 'CHF 69.90',
            discountedPrice: 'CHF 49.62',
            discountText: '–29 %',
            isFree: false,
          },
          media: [
            { role: 'SCREENSHOT', type: 'IMAGE', url: 'https://image.example/shot.png' },
            { role: 'MASTER', type: 'IMAGE', url: 'https://image.example/master.png' },
          ],
        },
        {
          __typename: 'Product',
          id: 'EP0001-CUSA09303_00-DLCEXPANSION2C02',
          name: 'Assassin’s Creed Odyssey EP2.2: Torment of Hades',
          platforms: ['PS4'],
          storeDisplayClassification: 'LEVEL',
          price: {
            basePrice: 'Nicht verfügbar',
            discountedPrice: 'Nicht verfügbar',
            discountText: null,
            isFree: false,
          },
        },
        { __typename: 'Concept', id: '10012069', name: 'Lords of the Fallen II', price: null },
      ],
    },
  },
};

void test('searchPlayStationStoreProducts sends the persisted search query with locale headers', async () => {
  const { fetchImpl, requests } = fakeFetch(200, searchReply);
  await searchPlayStationStoreProducts('Astro Bot', options(fetchImpl));

  assert.equal(requests.length, 1);
  const { url, headers } = requests[0];
  assert.equal(url.origin + url.pathname, 'https://store.example/api/graphql/v1/op');
  assert.equal(url.searchParams.get('operationName'), 'getSearchResults');
  assert.deepEqual(JSON.parse(url.searchParams.get('variables') ?? '{}'), {
    countryCode: 'CH',
    languageCode: 'de',
    nextCursor: '',
    pageOffset: 0,
    pageSize: 24,
    searchTerm: 'Astro Bot',
  });
  assert.deepEqual(JSON.parse(url.searchParams.get('extensions') ?? '{}'), {
    persistedQuery: { version: 1, sha256Hash: PLAYSTATION_STORE_SEARCH_QUERY_HASH },
  });
  assert.equal(headers['x-psn-store-locale-override'], 'de-CH');
  // Without it the API's cross-site request check rejects a GET.
  assert.equal(headers['Content-Type'], 'application/json');
});

void test('searchPlayStationStoreProducts keeps products and parses their display prices', async () => {
  const { fetchImpl } = fakeFetch(200, searchReply);
  const products = await searchPlayStationStoreProducts('Astro Bot', options(fetchImpl));

  assert.deepEqual(
    products.map((product) => product.productId),
    [
      'EP9000-CUSA13560_00-PFVRDEMO000000EU',
      'EP9000-PPSA21567_00-0000000000000000',
      'EP0001-CUSA09303_00-DLCEXPANSION2C02',
    ],
    'concepts are dropped'
  );
  assert.deepEqual(products[1], {
    productId: 'EP9000-PPSA21567_00-0000000000000000',
    name: 'ASTRO BOT',
    platforms: ['PS5'],
    classification: 'FULL_GAME',
    amount: 49.62,
    regularAmount: 69.9,
    currency: 'CHF',
    discountPercent: 29,
    isFree: false,
    imageUrl: 'https://image.example/master.png',
  });
  assert.equal(products[0].isFree, true);
  assert.equal(products[0].amount, 0);
  // "Nicht verfügbar" (not for sale) has no price.
  assert.equal(products[2].amount, null);
  assert.equal(products[2].isFree, false);
});

function productReply(webctas: unknown[]) {
  return {
    data: {
      productRetrieve: { id: 'EP9000-PPSA21567_00-0000000000000000', name: 'ASTRO BOT', webctas },
    },
  };
}

const discountedCta = {
  type: 'ADD_TO_CART',
  price: {
    basePriceValue: 6990,
    discountedValue: 4962,
    currencyCode: 'CHF',
    isFree: false,
    applicability: 'APPLICABLE',
    serviceBranding: ['NONE'],
    isTiedToSubscription: false,
    endTime: '1795219140000',
  },
};

void test('fetchPlayStationStoreProductPrice reads the exact price and sale end', async () => {
  const { fetchImpl, requests } = fakeFetch(200, productReply([discountedCta]));
  const price = await fetchPlayStationStoreProductPrice(
    'EP9000-PPSA21567_00-0000000000000000',
    options(fetchImpl)
  );

  assert.equal(
    requests[0].url.searchParams.get('operationName'),
    'productRetrieveForCtasWithPrice'
  );
  assert.deepEqual(JSON.parse(requests[0].url.searchParams.get('extensions') ?? '{}'), {
    persistedQuery: { version: 1, sha256Hash: PLAYSTATION_STORE_PRODUCT_PRICE_QUERY_HASH },
  });
  assert.deepEqual(price, {
    productId: 'EP9000-PPSA21567_00-0000000000000000',
    name: 'ASTRO BOT',
    amount: 49.62,
    regularAmount: 69.9,
    currency: 'CHF',
    discountPercent: 29,
    isFree: false,
    saleEndsAt: '2026-11-20T23:59:00.000Z',
  });
});

void test('fetchPlayStationStoreProductPrice skips PS Plus prices for the price everyone pays', async () => {
  const plusCta = {
    type: 'UPSELL_PS_PLUS_DISCOUNT',
    price: {
      ...discountedCta.price,
      discountedValue: 3495,
      serviceBranding: ['PS_PLUS'],
    },
  };
  const fullPriceCta = {
    type: 'ADD_TO_CART',
    price: { ...discountedCta.price, discountedValue: 6990, endTime: null },
  };
  const { fetchImpl } = fakeFetch(200, productReply([plusCta, fullPriceCta]));
  const price = await fetchPlayStationStoreProductPrice(
    'EP9000-PPSA21567_00-0000000000000000',
    options(fetchImpl)
  );

  assert.ok(price);
  assert.equal(price.amount, 69.9);
  assert.equal(price.discountPercent, 0);
  assert.equal(price.saleEndsAt, null);
});

void test('fetchPlayStationStoreProductPrice reads a free game', async () => {
  const freeCta = {
    type: 'DOWNLOAD',
    price: {
      basePriceValue: 0,
      discountedValue: 0,
      currencyCode: 'CHF',
      isFree: true,
      applicability: 'APPLICABLE',
      serviceBranding: ['NONE'],
      isTiedToSubscription: false,
      endTime: null,
    },
  };
  const { fetchImpl } = fakeFetch(200, productReply([freeCta]));
  const price = await fetchPlayStationStoreProductPrice(
    'EP9000-PPSA21567_00-0000000000000000',
    options(fetchImpl)
  );
  assert.ok(price);
  assert.equal(price.isFree, true);
  assert.equal(price.amount, 0);
});

void test('fetchPlayStationStoreProductPrice returns null for a product the store no longer sells', async () => {
  const { fetchImpl } = fakeFetch(200, {
    errors: [
      {
        message: 'Product not available for [EP1018-PPSA04277_00-HOGWARTSLEGACY01, CH, de]',
        extensions: { error: { reason: 'data_not_found', code: 3166081 } },
      },
    ],
    data: { productRetrieve: null },
  });
  assert.equal(
    await fetchPlayStationStoreProductPrice(
      'EP1018-PPSA04277_00-HOGWARTSLEGACY01',
      options(fetchImpl)
    ),
    null
  );
});

void test('fetchPlayStationStoreProductPrice returns null when there is only a subscription price', async () => {
  const { fetchImpl } = fakeFetch(
    200,
    productReply([
      { type: 'SUBSCRIBE', price: { ...discountedCta.price, isTiedToSubscription: true } },
    ])
  );
  assert.equal(
    await fetchPlayStationStoreProductPrice(
      'EP9000-PPSA21567_00-0000000000000000',
      options(fetchImpl)
    ),
    null
  );
});

void test('a rejected query hash raises PlayStationStoreQueryRejectedError', async () => {
  const { fetchImpl } = fakeFetch(400, {
    message: `Query ${PLAYSTATION_STORE_SEARCH_QUERY_HASH} not whitelisted`,
  });
  await assert.rejects(
    searchPlayStationStoreProducts('Hades II', options(fetchImpl)),
    (error) =>
      error instanceof PlayStationStoreQueryRejectedError &&
      error.message.includes('getSearchResults') &&
      error.message.includes('not whitelisted')
  );
});

void test('other failures raise an error naming the status', async () => {
  const { fetchImpl } = fakeFetch(503, { message: 'Service Unavailable' });
  await assert.rejects(searchPlayStationStoreProducts('Hades II', options(fetchImpl)), {
    message:
      'PlayStation Store getSearchResults request failed with status 503: Service Unavailable',
  });
});

void test('a reply without data raises an error with the first GraphQL error', async () => {
  const { fetchImpl } = fakeFetch(200, { errors: [{ message: 'Internal error' }], data: null });
  await assert.rejects(searchPlayStationStoreProducts('Hades II', options(fetchImpl)), {
    message: 'PlayStation Store getSearchResults returned no data: Internal error',
  });
});

void test('parsePlayStationStoreDisplayPrice handles the store price formats', () => {
  assert.equal(parsePlayStationStoreDisplayPrice('CHF 49.62'), 49.62);
  assert.equal(parsePlayStationStoreDisplayPrice('CHF 69.90'), 69.9);
  assert.equal(parsePlayStationStoreDisplayPrice('49,62 €'), 49.62);
  assert.equal(parsePlayStationStoreDisplayPrice("CHF 1'299.00"), 1299);
  assert.equal(parsePlayStationStoreDisplayPrice('1.299,50 €'), 1299.5);
  assert.equal(parsePlayStationStoreDisplayPrice('¥7,920'), 7920);
  assert.equal(parsePlayStationStoreDisplayPrice('Kostenlos'), null);
  assert.equal(parsePlayStationStoreDisplayPrice('Nicht verfügbar'), null);
  assert.equal(parsePlayStationStoreDisplayPrice(null), null);
});

void test('parsePlayStationStoreDisplayCurrency reads a code or a symbol', () => {
  assert.equal(parsePlayStationStoreDisplayCurrency('CHF 49.62'), 'CHF');
  assert.equal(parsePlayStationStoreDisplayCurrency('49,62 €'), 'EUR');
  assert.equal(parsePlayStationStoreDisplayCurrency('£39.99'), 'GBP');
  assert.equal(parsePlayStationStoreDisplayCurrency('Kostenlos'), null);
  // "$" could be USD, CAD or AUD: the store's country decides.
  assert.equal(parsePlayStationStoreDisplayCurrency('$69.99'), null);
});

void test('parsePlayStationStoreDiscountPercent reads the discount label', () => {
  assert.equal(parsePlayStationStoreDiscountPercent('–29 %'), 29);
  assert.equal(parsePlayStationStoreDiscountPercent('-50%'), 50);
  assert.equal(parsePlayStationStoreDiscountPercent('Kostenlos'), null);
  assert.equal(parsePlayStationStoreDiscountPercent(null), null);
});

void test('parsePlayStationStoreProductId accepts an ID or a store product URL', () => {
  const id = 'EP9000-PPSA21567_00-0000000000000000';
  assert.equal(parsePlayStationStoreProductId(id), id);
  assert.equal(parsePlayStationStoreProductId(` ${id} `), id);
  assert.equal(
    parsePlayStationStoreProductId(`https://store.playstation.com/de-ch/product/${id}`),
    id
  );
  assert.equal(
    parsePlayStationStoreProductId(`https://store.playstation.com/en-us/product/${id}?x=1`),
    id
  );
  assert.equal(parsePlayStationStoreProductId(`https://evil.example/product/${id}`), null);
  assert.equal(
    parsePlayStationStoreProductId('https://store.playstation.com/de-ch/concept/1'),
    null
  );
  assert.equal(parsePlayStationStoreProductId('not an id'), null);
  assert.equal(parsePlayStationStoreProductId(42), null);
});

void test('buildPlayStationStoreProductUrl builds the localized product page URL', () => {
  assert.equal(
    buildPlayStationStoreProductUrl('EP9000-PPSA21567_00-0000000000000000', LOCALE),
    'https://store.playstation.com/de-ch/product/EP9000-PPSA21567_00-0000000000000000'
  );
});
