import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  extractMetacriticSearchResults,
  METACRITIC_SEARCH_RESULT_FALLBACK_READY_SELECTOR,
  METACRITIC_SEARCH_RESULT_LINK_SELECTOR,
  METACRITIC_SEARCH_RESULT_METADATA_SELECTOR,
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

const payloadYearFallbackHtml = `
  <main>
    <section>
      <article>
        <div>
          <a href="/game/super-mario-3d-world-plus-bowsers-fury/">
            <img src="https://images.example/current.jpg" alt="cover" />
            <h3>Super Mario 3D World + Bowser's FurygameNintendo Switch89</h3>
          </a>
        </div>
        <div>
          <span data-testid="product-metascore"><span>89</span></span>
          <span>Nintendo Switch</span>
        </div>
      </article>
    </section>
    <script type="application/json" id="__NUXT_DATA__">
      [{"id":1,"type":2,"typeId":3,"title":4,"slug":5,"images":6,"criticScoreSummary":7,"rating":8,"releaseDate":9,"premiereYear":10,"genres":11,"platforms":12},1300522978,"game-title",13,"Super Mario 3D World + Bowser's Fury","super-mario-3d-world-plus-bowsers-fury",[],{"url":14,"score":15},"E","2021-02-12",2021,[16],{"id":17,"name":18},"3D Platformer",[19],{"id":20,"name":21},"Nintendo Switch","/game/super-mario-3d-world-plus-bowsers-fury/critic-reviews/",89]
    </script>
  </main>
`;

const payloadOnlyHtml = `
  <main>
    <script type="application/json" id="__NUXT_DATA__">
      [{"id":1,"type":2,"typeId":3,"title":4,"slug":5,"images":6,"criticScoreSummary":7,"rating":8,"releaseDate":9,"premiereYear":10,"genres":11,"platforms":12},1300522978,"game-title",13,"Super Mario 3D World + Bowser's Fury","super-mario-3d-world-plus-bowsers-fury",[13],{"url":14,"score":15},"E","2021-02-12",2021,[16],{"id":17,"name":18},"3D Platformer",[19],{"id":20,"name":21},"Nintendo Switch","https://www.metacritic.com/provider/6/3/6-1-853953-13.jpg","/game/super-mario-3d-world-plus-bowsers-fury/critic-reviews/",89]
    </script>
  </main>
`;

const payloadOnlyMultiRowHtml = `
  <main>
    <script type="application/json" id="__NUXT_DATA__">
      [{"id":1626,"type":1627,"typeId":1628,"title":1629,"slug":1630,"images":1631,"criticScoreSummary":1642,"rating":1645,"releaseDate":1646,"premiereYear":1647,"genres":1648,"platforms":1651,"seasonCount":15,"description":1654},1300522978,"game-title",13,"Super Mario 3D World + Bowser's Fury","super-mario-3d-world-plus-bowsers-fury",[1632],{"id":1633,"filename":1634},"https://images.example/mario.jpg",{"url":1643,"score":1644},"/game/super-mario-3d-world-plus-bowsers-fury/critic-reviews/",89,"E","2021-02-12",2021,[1649],{"id":1263,"name":1650},"3D Platformer",[1652],{"id":1263,"name":1653},"Nintendo Switch","Mario description",{"id":1656,"type":1627,"typeId":1628,"title":1657,"slug":1658,"images":1659,"criticScoreSummary":1667,"rating":1645,"releaseDate":1670,"premiereYear":1671,"genres":1672,"platforms":1675,"seasonCount":15,"description":1678},1300482947,"game-title",13,"Mario & Luigi: Bowser's Inside Story + Bowser Jr.'s Journey","mario-and-luigi-bowsers-inside-story-plus-bowser",[1660],{"id":1661,"filename":1662},"https://images.example/bowser.jpg",{"url":1668,"score":1669},"/game/mario-and-luigi-bowsers-inside-story-plus-bowser/critic-reviews/",84,"E","2019-01-11",2019,[1673],{"id":1263,"name":1674},"JRPG",[1676],{"id":1263,"name":1677},"3DS","Bowser description"]
    </script>
  </main>
`;

const payloadRegexMultiScriptHtml = `
  <main>
    <script>
      window.__NUXT_DATA__ = [0,"game-title",13,"First Quest","first-quest","2021-02-12",2021,[],{"name":"Genre"},"Genre",[],{"name":"Nintendo Switch"},"Nintendo Switch","https://images.example/first.jpg","/game/first-quest/critic-reviews/",91];
    </script>
    <script>
      window.__NUXT_DATA__ = [0,"game-title",13,"Second Quest","second-quest","2022-03-10",2022,[],{"name":"Genre"},"Genre",[],{"name":"PC"},"PC","https://images.example/second.jpg","/game/second-quest/critic-reviews/",87];
    </script>
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

test('extractMetacriticSearchResults fills a missing year from the Nuxt payload', async () => {
  const results = await parseHtml(payloadYearFallbackHtml);

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

test('extractMetacriticSearchResults falls back to the Nuxt payload when no result rows are rendered', async () => {
  const results = await parseHtml(payloadOnlyHtml);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    // prettier-ignore
    title: 'Super Mario 3D World + Bowser\'s Fury',
    releaseYear: 2021,
    platform: 'Nintendo Switch',
    metacriticScore: 89,
    metacriticUrl: 'https://www.metacritic.com/game/super-mario-3d-world-plus-bowsers-fury/',
    imageUrl: null,
  });
});

test('extractMetacriticSearchResults keeps multiple payload rows with year and platform when no result rows are rendered', async () => {
  const results = await parseHtml(payloadOnlyMultiRowHtml);

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    // prettier-ignore
    title: 'Super Mario 3D World + Bowser\'s Fury',
    releaseYear: 2021,
    platform: 'Nintendo Switch',
    metacriticScore: 89,
    metacriticUrl: 'https://www.metacritic.com/game/super-mario-3d-world-plus-bowsers-fury/',
    imageUrl: 'https://images.example/mario.jpg',
  });
  assert.deepEqual(results[1], {
    // prettier-ignore
    title: 'Mario & Luigi: Bowser\'s Inside Story + Bowser Jr.\'s Journey',
    releaseYear: 2019,
    platform: '3DS',
    metacriticScore: 84,
    metacriticUrl:
      'https://www.metacritic.com/game/mario-and-luigi-bowsers-inside-story-plus-bowser/',
    imageUrl: 'https://images.example/bowser.jpg',
  });
});

test('extractMetacriticSearchResults resets regex payload matching between multiple scripts', async () => {
  const results = await parseHtml(payloadRegexMultiScriptHtml);

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    title: 'First Quest',
    releaseYear: 2021,
    platform: 'Nintendo Switch',
    metacriticScore: 91,
    metacriticUrl: 'https://www.metacritic.com/game/first-quest/',
    imageUrl: 'https://images.example/first.jpg',
  });
  assert.deepEqual(results[1], {
    title: 'Second Quest',
    releaseYear: 2022,
    platform: 'PC',
    metacriticScore: 87,
    metacriticUrl: 'https://www.metacritic.com/game/second-quest/',
    imageUrl: 'https://images.example/second.jpg',
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
      `article:has\\(${METACRITIC_SEARCH_RESULT_LINK_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\):has\\(${METACRITIC_SEARCH_RESULT_METADATA_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`
    )
  );
});

test('search readiness selector matches current link-first result cards', async () => {
  await page.setContent(currentHtml, { waitUntil: 'domcontentloaded' });

  const matchedFallbackSelector = await page.evaluate(
    ({ readySelector, fallbackSelector }) => {
      const node = document.querySelector(readySelector);
      return Boolean(node?.matches(fallbackSelector));
    },
    {
      readySelector: METACRITIC_SEARCH_RESULTS_READY_SELECTOR,
      fallbackSelector: METACRITIC_SEARCH_RESULT_FALLBACK_READY_SELECTOR,
    }
  );

  assert.equal(matchedFallbackSelector, true);
});

test('search readiness selector ignores navigation links outside the results container', async () => {
  await page.setContent(navLinkBeforeResultsHtml, { waitUntil: 'domcontentloaded' });

  const handle = await page.evaluate(
    (selector) => document.querySelector(selector),
    METACRITIC_SEARCH_RESULTS_READY_SELECTOR
  );

  assert.equal(handle, null);
});
