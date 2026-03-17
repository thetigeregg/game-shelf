import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { extractMetacriticSearchResults } from './search-parser.mjs';

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

async function parseHtml(html) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.evaluate(extractMetacriticSearchResults);
  } finally {
    await browser.close();
  }
}

test('extractMetacriticSearchResults parses legacy search result rows', async () => {
  const results = await parseHtml(legacyHtml);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    title: "Super Mario 3D World + Bowser's Fury",
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
    title: "Super Mario 3D World + Bowser's Fury",
    releaseYear: 2021,
    platform: 'Nintendo Switch',
    metacriticScore: 89,
    metacriticUrl: 'https://www.metacritic.com/game/super-mario-3d-world-plus-bowsers-fury/',
    imageUrl: 'https://images.example/current.jpg',
  });
});
