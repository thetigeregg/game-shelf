import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  extractMetacriticSearchResults,
  METACRITIC_SEARCH_RESULT_LINK_SELECTOR,
  METACRITIC_SEARCH_RESULT_ROW_SELECTOR,
  METACRITIC_SEARCH_RESULTS_READY_SELECTOR,
} from './search-parser.mjs';

let browser;
let page;

const legacyHtml = `
  <div data-testid="search-results">
    <div data-testid="search-result-item">
      <a href="/game/super-mario-3d-world-plus-bowsers-fury/">
        <img src="https://images.example/legacy.jpg" alt="cover" />
      </a>
      <div data-testid="tag-list"><span>Game</span></div>
      <h3 data-testid="product-title">Super Mario 3D World + Bowser's Fury</h3>
      <div data-testid="product-release-date">Feb 12, 2021</div>
      <div data-testid="product-platform">Nintendo Switch</div>
      <div data-testid="product-metascore"><span>89</span></div>
    </div>
  </div>
`;

const currentHtml = `
  <main>
    <section>
      <article>
        <div>
          <a href="/game/super-mario-3d-world-plus-bowsers-fury/">
            <img src="https://images.example/current.jpg" alt="cover" />
            <h3>Super Mario 3D World + Bowser's FurygameFeb 12, 2021Nintendo Switch89</h3>
          </a>
        </div>
        <div>
          <span data-testid="product-metascore"><span>89</span></span>
          <span>Nintendo Switch</span>
          <time>Feb 12, 2021</time>
        </div>
      </article>
    </section>
  </main>
`;

const hostileAbsoluteUrlHtml = `
  <div data-testid="search-results">
    <div data-testid="search-result-item">
      <a href="https://metacritic.com.evil.tld/game/super-mario-3d-world-plus-bowsers-fury/">
        <img src="https://images.example/hostile.jpg" alt="cover" />
      </a>
      <div data-testid="tag-list"><span>Game</span></div>
      <h3 data-testid="product-title">Super Mario 3D World + Bowser's Fury</h3>
      <div data-testid="product-release-date">Feb 12, 2021</div>
      <div data-testid="product-platform">Nintendo Switch</div>
      <div data-testid="product-metascore"><span>89</span></div>
    </div>
  </div>
`;

const seriesSHtml = `
  <main>
    <section>
      <article>
        <a href="/game/forza-horizon-5/">
          <h3>Forza Horizon 5gameNov 9, 2021</h3>
        </a>
        <div>
          <span data-testid="product-metascore"><span>88</span></span>
          <span>Xbox Series S</span>
          <time>Nov 9, 2021</time>
        </div>
      </article>
    </section>
  </main>
`;

const linkRowDirectTextHtml = `
  <main>
    <section>
      <article>
        <a href="/game/direct-text-adventure/">
          Direct Text Adventure
          <span data-testid="product-metascore"><span>81</span></span>
          <span>PC</span>
          <time>Apr 4, 2024</time>
        </a>
      </article>
    </section>
  </main>
`;

const pcTitleHtml = `
  <div data-testid="search-results">
    <div data-testid="search-result-item">
      <a href="/game/pc-building-simulator/">
        <img src="https://images.example/pc-building.jpg" alt="cover" />
      </a>
      <div data-testid="tag-list"><span>Game</span></div>
      <h3 data-testid="product-title">PC Building Simulator</h3>
      <div data-testid="product-release-date">Oct 10, 2018</div>
      <div data-testid="product-platform">PC</div>
      <div data-testid="product-metascore"><span>70</span></div>
    </div>
  </div>
`;

const noPlatformFalsePositiveHtml = `
  <main>
    <section>
      <article>
        <a href="/game/epic-quest/">
          <h3>Epic QuestgameMar 3, 2022</h3>
        </a>
        <div>
          <span data-testid="product-metascore"><span>77</span></span>
          <span>An epic adventure</span>
          <time>Mar 3, 2022</time>
        </div>
      </article>
    </section>
  </main>
`;

const navLinkBeforeResultsHtml = `
  <main>
    <nav>
      <a href="/game/navigation-only/">Navigation Link</a>
    </nav>
    <div data-testid="search-results"></div>
  </main>
`;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

test.after(async () => {
  await page?.close();
  await browser?.close();
});

async function parseHtml(html) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return await page.evaluate(extractMetacriticSearchResults, {
    gameLinkSelector: METACRITIC_SEARCH_RESULT_LINK_SELECTOR,
    rowSelector: METACRITIC_SEARCH_RESULT_ROW_SELECTOR,
  });
}

async function parseHtmlWithDefaultConfig(html) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return await page.evaluate(extractMetacriticSearchResults);
}

test('extractMetacriticSearchResults parses legacy search result rows', async () => {
  const results = await parseHtml(legacyHtml);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    // prettier-ignore
    title: 'Super Mario 3D World + Bowser\'s Fury',
    releaseYear: 2021,
    platform: 'Nintendo Switch',
    metacriticScore: 89,
    metacriticUrl: 'https://www.metacritic.com/game/super-mario-3d-world-plus-bowsers-fury/',
    imageUrl: 'https://images.example/legacy.jpg',
  });
});

test('extractMetacriticSearchResults parses current link-first layout without legacy row selectors', async () => {
  const results = await parseHtml(currentHtml);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    // prettier-ignore
    title: 'Super Mario 3D World + Bowser\'s Fury',
    releaseYear: 2021,
    platform: 'Nintendo Switch',
    metacriticScore: 89,
    metacriticUrl: 'https://www.metacritic.com/game/super-mario-3d-world-plus-bowsers-fury/',
    imageUrl: 'https://images.example/current.jpg',
  });
});

test('extractMetacriticSearchResults falls back to link scanning when rowSelector is omitted', async () => {
  const results = await parseHtmlWithDefaultConfig(legacyHtml);

  assert.equal(results.length, 1);
  assert.equal(
    results[0].metacriticUrl,
    'https://www.metacritic.com/game/super-mario-3d-world-plus-bowsers-fury/'
  );
});

test('extractMetacriticSearchResults keeps link-row titles when the row is the game anchor', async () => {
  await page.setContent(linkRowDirectTextHtml, { waitUntil: 'domcontentloaded' });
  const results = await page.evaluate(extractMetacriticSearchResults, {
    gameLinkSelector: METACRITIC_SEARCH_RESULT_LINK_SELECTOR,
    rowSelector: 'a[href*="/game/"]',
  });

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    title: 'Direct Text Adventure',
    releaseYear: 2024,
    platform: 'PC',
    metacriticScore: 81,
    metacriticUrl: 'https://www.metacritic.com/game/direct-text-adventure/',
    imageUrl: null,
  });
});

test('extractMetacriticSearchResults keeps titles that legitimately start with PC', async () => {
  const results = await parseHtml(pcTitleHtml);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    title: 'PC Building Simulator',
    releaseYear: 2018,
    platform: 'PC',
    metacriticScore: 70,
    metacriticUrl: 'https://www.metacritic.com/game/pc-building-simulator/',
    imageUrl: 'https://images.example/pc-building.jpg',
  });
});

test('extractMetacriticSearchResults rejects hostile absolute URLs outside Metacritic', async () => {
  const results = await parseHtml(hostileAbsoluteUrlHtml);

  assert.equal(results.length, 0);
});

test('extractMetacriticSearchResults keeps Xbox Series S distinct when inferred from text', async () => {
  const results = await parseHtml(seriesSHtml);

  assert.equal(results.length, 1);
  assert.equal(results[0].platform, 'Xbox Series S');
});

test('extractMetacriticSearchResults does not infer PC from unrelated words', async () => {
  const results = await parseHtml(noPlatformFalsePositiveHtml);

  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Epic Quest');
  assert.equal(results[0].platform, null);
});

test('search selector exports keep browser wait and parser row selection aligned', () => {
  assert.match(
    METACRITIC_SEARCH_RESULTS_READY_SELECTOR,
    new RegExp(METACRITIC_SEARCH_RESULT_ROW_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  assert.match(
    METACRITIC_SEARCH_RESULTS_READY_SELECTOR,
    new RegExp(
      `\\[data-testid="search-results"\\]\\s+${METACRITIC_SEARCH_RESULT_LINK_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    )
  );
});

test('search readiness selector ignores navigation links outside the results container', async () => {
  await page.setContent(navLinkBeforeResultsHtml, { waitUntil: 'domcontentloaded' });

  const handle = await page
    .waitForSelector(METACRITIC_SEARCH_RESULTS_READY_SELECTOR, { timeout: 100 })
    .catch(() => null);

  assert.equal(handle, null);
});
