import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { extractMetacriticSearchResults } from './search-parser.mjs';

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
