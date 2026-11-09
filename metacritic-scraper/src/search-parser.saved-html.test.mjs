import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  extractMetacriticSearchResults,
  METACRITIC_SEARCH_RESULT_LINK_SELECTOR,
  METACRITIC_SEARCH_RESULT_ROW_SELECTOR,
} from './search-parser.mjs';

function parseHtml(html) {
  const dom = new JSDOM(html, { url: 'https://www.metacritic.com/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.URL = dom.window.URL;

  return extractMetacriticSearchResults({
    gameLinkSelector: METACRITIC_SEARCH_RESULT_LINK_SELECTOR,
    rowSelector: METACRITIC_SEARCH_RESULT_ROW_SELECTOR,
  });
}

test('extractMetacriticSearchResults keeps tbd results from the saved Nuxt layout', () => {
  const html = `
    <main>
      <section>
        <article>
          <a href="/game/stonks-9800-stock-market-simulator/">
            <img src="https://images.example/stonks.jpg" alt="cover" />
            <h3>STONKS-9800: Stock Market SimulatorgameTBA - Early AccessPC, and moretbd</h3>
          </a>
          <div>
            <span data-testid="product-metascore"><span>tbd</span></span>
            <span>PC, and more</span>
            <span>TBA - Early Access</span>
            <span class="visually-hidden">2097</span>
          </div>
        </article>
      </section>
      <script type="application/json" id="__NUXT_DATA__">
        [{"id":1,"type":2,"typeId":3,"title":4,"slug":5,"images":6,"criticScoreSummary":7,"rating":8,"releaseDate":9,"premiereYear":10,"genres":11,"platforms":12},1300785151,"game-title",13,"STONKS-9800: Stock Market Simulator","stonks-9800-stock-market-simulator",[],{"url":14,"score":15},"E","TBA - Early Access",2097,[16],{"id":17,"name":18},"Simulation",[19],{"id":20,"name":21},"PC","/game/stonks-9800-stock-market-simulator/critic-reviews/",0]
      </script>
    </main>
  `;

  const results = parseHtml(html);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    title: 'STONKS-9800: Stock Market Simulator',
    releaseYear: null,
    platform: 'PC',
    metacriticPlatforms: ['PC'],
    metacriticScore: null,
    metacriticUrl: 'https://www.metacritic.com/game/stonks-9800-stock-market-simulator/',
    imageUrl: 'https://images.example/stonks.jpg',
  });
});

test('extractMetacriticSearchResults normalizes plain TBA payload years for tbd results', () => {
  const html = `
    <main>
      <section>
        <article>
          <a href="/game/star-wars-eclipse/">
            <img src="https://images.example/eclipse.jpg" alt="cover" />
            <h3>Star Wars EclipsegameTBAPCtbd</h3>
          </a>
          <div>
            <span data-testid="product-metascore"><span>tbd</span></span>
            <span>PC</span>
            <span>TBA</span>
            <span class="visually-hidden">2097</span>
          </div>
        </article>
      </section>
      <script type="application/json" id="__NUXT_DATA__">
        [{"id":1,"type":2,"typeId":3,"title":4,"slug":5,"images":6,"criticScoreSummary":7,"rating":8,"releaseDate":9,"premiereYear":10,"genres":11,"platforms":12},1300835783,"game-title",13,"Star Wars Eclipse","star-wars-eclipse",[],{"url":14,"score":15},"RP","TBA",2097,[16],{"id":17,"name":18},"Action Adventure",[19],{"id":20,"name":21},"PC","/game/star-wars-eclipse/critic-reviews/",0]
      </script>
    </main>
  `;

  const results = parseHtml(html);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    title: 'Star Wars Eclipse',
    releaseYear: null,
    platform: 'PC',
    metacriticPlatforms: ['PC'],
    metacriticScore: null,
    metacriticUrl: 'https://www.metacritic.com/game/star-wars-eclipse/',
    imageUrl: 'https://images.example/eclipse.jpg',
  });
});

test('extractMetacriticSearchResults does not infer release year from numbered titles like Metro 2033', () => {
  const html = `
    <main>
      <section>
        <article>
          <a href="/game/metro-2033-redux/">
            <img src="https://images.example/metro.jpg" alt="cover" />
            <h3>Metro: 2033 ReduxgamePC90</h3>
          </a>
          <div>
            <span data-testid="product-metascore"><span>90</span></span>
            <span>PC</span>
          </div>
        </article>
      </section>
      <script type="application/json" id="__NUXT_DATA__">
        [{"id":1,"type":2,"typeId":3,"title":4,"slug":5,"images":6,"criticScoreSummary":7,"rating":8,"releaseDate":9,"premiereYear":10,"genres":11,"platforms":12},1300735541,"game-title",13,"Metro: 2033 Redux","metro-2033-redux",[],{"url":14,"score":15},"M","2014-08-26",2014,[16],{"id":17,"name":18},"Shooter",[19],{"id":20,"name":21},"PC","/game/metro-2033-redux/critic-reviews/",90]
      </script>
    </main>
  `;

  const results = parseHtml(html);

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    title: 'Metro: 2033 Redux',
    releaseYear: 2014,
    platform: 'PC',
    metacriticPlatforms: ['PC'],
    metacriticScore: 90,
    metacriticUrl: 'https://www.metacritic.com/game/metro-2033-redux/',
    imageUrl: 'https://images.example/metro.jpg',
  });
});

test('extractMetacriticSearchResults reads the title from the current search-item card', () => {
  // Trimmed from the live search page (2026-11) for an unscored, early-access game; no embedded
  // payload, so the title must come from the card itself.
  const html = `
    <main>
      <div class="search-item" data-testid="search-item">
        <a href="/game/off-the-grid/" class="search-item__content">
          <div><picture><img src="https://images.example/off-the-grid.jpg" alt="" /></picture></div>
          <div class="overflow-hidden">
            <p class="truncate mb-2 text-2xl font-bold">Off The Grid</p>
            <div class="c-search-product-meta--search-page">
              <ul class="global-tag-list" data-testid="tag-list"><li><span>game</span></li></ul>
              <ul class="truncate inline list-none">
                <li><span>TBA - Early Access</span></li>
                <li><span><strong>PlayStation 5</strong>, and more</span></li>
              </ul>
              <div data-testid="product-metascore"><span>tbd</span></div>
            </div>
          </div>
        </a>
      </div>
    </main>
  `;

  const results = parseHtml(html);

  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Off The Grid');
  assert.equal(results[0].metacriticScore, null);
  assert.equal(results[0].metacriticUrl, 'https://www.metacritic.com/game/off-the-grid/');
});

test('extractMetacriticSearchResults strips card metadata glued onto a title', () => {
  // When only the whole card text is available, the "game" tag runs straight into the release
  // info: everything from that tag on is metadata.
  const cases = [
    ['Off the Grid: Bad DreamgameJune 2028PC, and moretbd', 'Off the Grid: Bad Dream'],
    ['Schedule I: Dope Empire VRgameTBAMeta Questtbd', 'Schedule I: Dope Empire VR'],
    ['Hades Ultimate Fighting BallgameTBA - Early AccessPCtbd', 'Hades Ultimate Fighting Ball'],
    ['Some TitlegameEarly AccessPCtbd', 'Some Title'],
    ['Some TitlegameComing SoonPlayStation 5tbd', 'Some Title'],
    ['Some TitlegameQ1 2027PCtbd', 'Some Title'],
    ['Endless Endgame', 'Endless Endgame'],
  ];
  for (const [glued, expected] of cases) {
    const results = parseHtml(`
      <main>
        <article>
          <a href="/game/example/"><span>${glued}</span></a>
          <div><span data-testid="product-metascore"><span>tbd</span></span></div>
        </article>
      </main>
    `);
    assert.equal(results[0]?.title, expected, glued);
  }
});

test('extractMetacriticSearchResults keeps a real title that contains "game" followed by a year', () => {
  // The glued-metadata cleanup is only for text taken from a whole card, not a title element.
  const results = parseHtml(`
    <main>
      <article>
        <a href="/game/minigame2049/"><h3>Minigame2049</h3></a>
        <div><span data-testid="product-metascore"><span>71</span></span></div>
      </article>
    </main>
  `);
  assert.equal(results[0]?.title, 'Minigame2049');
});

test('extractMetacriticSearchResults prefers the card title over an earlier heading', () => {
  // Selectors are tried in priority order, not page order.
  const results = parseHtml(`
    <main>
      <div class="search-item" data-testid="search-item">
        <a href="/game/real-title/" class="search-item__content">
          <h4>Sponsored</h4>
          <div class="overflow-hidden"><p class="truncate">Real Title</p></div>
          <div data-testid="product-metascore"><span>tbd</span></div>
        </a>
      </div>
    </main>
  `);
  assert.equal(results[0]?.title, 'Real Title');
});
