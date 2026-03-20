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
