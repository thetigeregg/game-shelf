# Discovery Match Admin

## Purpose

Discovery Match Admin is an operator page for fixing metadata on discovery queue rows without editing collection or wishlist entries.

It is used to:

- inspect discovery rows that are still missing HLTB, review, or pricing data
- see whether a provider is missing, retrying, permanently missed, or already matched
- manually save or clear provider-specific matches
- reset HLTB or review retry state for rows that have reached permanent miss
- queue a targeted discovery enrichment run for one row or the current visible results

The page route is `/admin/discovery-matches` and it is opened from Settings.

## Access and authorization

In the app, the page uses the existing device write token from Settings. There is no separate UI-only admin token.

Server-side, the endpoints accept the same authorization model used for mutating requests. A request is authorized when it supplies a valid configured bearer token or a valid client write token header.

If no device write token is configured in the app, the page can still render, but loading and mutation controls stay unusable.

## What data this page operates on

This page only works on rows in the `games` table whose payload has:

```json
{
  "listType": "discovery"
}
```

It does not scan collection rows, wishlist rows, or arbitrary game records.

The list API reads discovery rows ordered by `updated_at DESC`, optionally filters by a case-insensitive title substring, computes provider state from each row payload, then returns only the rows that match the selected filter.

Important consequence: a game appears here because it exists as a discovery row and is unmatched for the selected provider filter. It does not appear here simply because it exists elsewhere in the app.

## What determines which games show up in the list

The page sends these filters when loading matches:

- `provider`: one of `hltb`, `review`, or `pricing`
- `state`: `all`, `missing`, `retrying`, or `permanentMiss`
- `search`: trimmed title search text
- `limit`: `100`

### Provider filter

The page always loads against the currently selected provider. That means the results are based on the selected provider's state, even though each row still shows badges for all three providers.

### State filter

- `Any unmatched` means the selected provider is anything except `matched`.
- `Missing` means no match data exists and there is no active retry history.
- `Retrying` means no match exists, but retry metadata exists such as attempts, `lastTriedAt`, or `nextTryAt`.
- `Permanent miss` means retries hit the cap and the provider is marked as permanently missed.

### Search filter

Search is a case-insensitive substring match against the discovery row title.

### Scan limit and visible limit

The frontend requests at most 100 results. The backend scans more than the visible limit to find enough unmatched rows, but it still caps the scan window. As a result, the page is a triage view, not a complete report across every discovery row in the database.

The note on the page shows both:

- `shown`: rows returned after provider/state filtering
- `scanned`: discovery rows examined before the final filter was applied

## How provider state is calculated

Each row shows a state for HLTB, review, and pricing.

### HLTB

HLTB is considered matched when any of these values exists:

- `hltbMainHours`
- `hltbMainExtraHours`
- `hltbCompletionistHours`

If none exist, the state is derived from `payload.enrichmentRetry.hltb`.

### Review

Review is considered matched when either of these is true:

- `reviewSource` is set and `reviewScore` exists
- `metacriticScore` exists

If no review match exists, the state is derived from `payload.enrichmentRetry.metacritic`.

### Pricing

Pricing is considered matched when either of these is true:

- `priceAmount` exists
- `priceIsFree === true`

If no pricing match exists, the state is derived from `payload.enrichmentRetry.psprices` for supported pricing platforms.

That means pricing can also appear as:

- `retrying` when retry metadata exists but no current price match is stored
- `permanentMiss` when PSPrices retries were exhausted and the provider is marked as permanently missed

Manual pricing saves clear the stored PSPrices retry metadata and lock the pricing provider for that row until the manual match is cleared or replaced.

## What the status badges mean

- `Matched`: the row already has usable provider data
- `Missing`: there is no provider data and no retry history that would make it retrying or permanent miss
- `Retrying (N)`: the row is currently in retry/backoff for that provider, with `N` recorded attempts
- `Permanent miss`: the provider exhausted retries and will not be attempted again until the retry state is reset or automatically rearmed by the enrichment rules

## What each control does

### Load matches

`Load matches` calls the unmatched-list endpoint with the current provider, state, search text, and limit.

It refreshes the page from server state. Nothing is changed in storage.

### Queue current results

`Queue current results` sends the currently visible discovery row keys to the server and enqueues background work for the selected provider.

Behavior:

- it targets only the rows currently visible in the admin list
- when `provider` is `pricing`, the route queues pricing refresh jobs for those rows instead of a `discovery_enrichment_run`
- when `provider` is `hltb` or `review`, the route queues a `discovery_enrichment_run` that targets only that provider and passes that provider as a forced locked refresh target
- discovery enrichment runs are deduped with a single discovery enrichment dedupe key
- pricing refresh jobs are deduped per queued Steam or PSPrices revalidation job
- if an equivalent job is already queued, the response is marked as deduped and no second job is added

This action does not edit the selected rows directly. It only queues background work.

#### Provider-specific behavior

When the selected provider is `pricing`, this action queues pricing refresh work directly:

- Steam rows queue `steam_price_revalidate`
- supported PlayStation rows queue `psprices_price_revalidate`
- pricing requeue ignores `psPricesMatchLocked`, so an admin-triggered refresh can run even when pricing was manually locked

When the selected provider is `hltb` or `review`, this action queues the discovery enrichment worker for those rows.

### Clear visible permanent misses

`Clear visible permanent misses` is available only when the selected provider is `hltb` or `review` and at least one visible row is currently in `permanentMiss`.

It resets retry state only for the visible rows currently marked permanent miss.

What it changes:

- HLTB resets `payload.enrichmentRetry.hltb`
- Review resets `payload.enrichmentRetry.metacritic`

What it does not change:

- it does not create a new match
- it does not unlock or relock provider fields
- it does not automatically run enrichment immediately

After clearing permanent misses, the row is eligible to be tried again on the next scheduled discovery enrichment run or after a manual requeue.

### Manage modal

`Manage` opens a modal for one discovery row and loads full provider detail.

The modal lets the operator:

- switch between HLTB, review, and pricing forms
- search upstream candidates
- apply a candidate into the form
- save the active provider form
- clear the active provider form
- queue targeted discovery enrichment for that single row

### Candidate search

The candidate search buttons do not persist anything by themselves.

They only look up likely upstream matches and fill the form when the operator taps a candidate.

#### HLTB candidate search

Uses the current query title, release year, and platform to search HLTB candidates.

Applying a candidate fills:

- HLTB game ID
- HLTB URL
- timing fields
- query title/year/platform

#### Review candidate search

Uses the current query title, release year, platform, and `platformIgdbId` to search review candidates.

Applying a candidate fills the review form using either the Metacritic or MobyGames source.

#### Pricing candidate search

Uses the discovery row identity and search text to look up pricing candidates.

Applying a candidate fills price fields and PSPrices URL/title fields.

### Save provider match

`Save` persists the active provider form back into the discovery row payload immediately.

The modal updates immediately after a successful save, and the visible list row is updated in place without requiring a full reload.

#### Saving HLTB

Saving HLTB writes provider fields such as:

- `hltbMatchGameId`
- `hltbMatchUrl`
- `hltbMainHours`
- `hltbMainExtraHours`
- `hltbCompletionistHours`
- `hltbMatchQueryTitle`
- `hltbMatchQueryReleaseYear`
- `hltbMatchQueryPlatform`

It also:

- sets `hltbMatchLocked = true`
- resets `enrichmentRetry.hltb` to zero attempts and no permanent miss

At least one HLTB match or timing field must be supplied or the save is rejected.

#### Saving review

Saving review writes provider fields such as:

- `reviewSource`
- `reviewScore`
- `reviewUrl`
- `metacriticScore`
- `metacriticUrl`
- `mobygamesGameId`
- `mobyScore`
- `reviewMatchQueryTitle`
- `reviewMatchQueryReleaseYear`
- `reviewMatchQueryPlatform`
- `reviewMatchPlatformIgdbId`
- `reviewMatchMobygamesGameId`

It also:

- sets `reviewMatchLocked = true`
- resets `enrichmentRetry.metacritic` to zero attempts and no permanent miss

At least one review field must be supplied or the save is rejected.

#### Saving pricing

Saving pricing writes provider fields such as:

- `priceSource`
- `priceFetchedAt`
- `priceAmount`
- `priceCurrency`
- `priceRegularAmount`
- `priceDiscountPercent`
- `priceIsFree`
- `priceUrl`
- `psPricesUrl`
- `psPricesTitle`
- `psPricesPlatform`

It also:

- sets `psPricesMatchLocked = true`

At least one of `priceAmount`, `priceIsFree`, or `priceUrl` must be supplied or the save is rejected.

### Clear provider match

`Clear` removes the active provider's saved fields from the discovery row and updates the row immediately.

#### Clearing HLTB

Clearing HLTB:

- nulls all HLTB match and query fields
- sets `hltbMatchLocked = false`
- resets `enrichmentRetry.hltb`

#### Clearing review

Clearing review:

- nulls all review and review-query fields
- sets `reviewMatchLocked = false`
- resets `enrichmentRetry.metacritic`

#### Clearing pricing

Clearing pricing:

- nulls all unified pricing and PSPrices match fields
- sets `psPricesMatchLocked = false`

Once a provider is cleared, automatic enrichment is allowed to populate it again if the relevant background or lookup path runs later.

### Queue this game

The modal-level queue action enqueues provider-specific background work for the selected discovery row.

Like the list-level queue button:

- `pricing` queues pricing refresh jobs for the selected row and any related discovery rows for the same IGDB game
- `hltb` and `review` queue a targeted `discovery_enrichment_run`
- equivalent queued work is deduped and reported as deduped instead of adding a duplicate job

## What locking means

Locking is the mechanism that makes manual matches stick.

When a provider is saved manually:

- HLTB saves set `hltbMatchLocked = true`
- review saves set `reviewMatchLocked = true`
- pricing saves set `psPricesMatchLocked = true`

These lock fields tell later automation which saved external match identity to preserve.

### HLTB and review locks

Locked HLTB and review rows still participate in automatic refresh.

The lock preserves the saved match context used for refresh, for example:

- `hltbMatchQueryTitle`, `hltbMatchQueryReleaseYear`, `hltbMatchQueryPlatform`
- `hltbMatchGameId` or `hltbMatchUrl` when available
- `reviewMatchQueryTitle`, `reviewMatchQueryReleaseYear`, `reviewMatchQueryPlatform`
- `reviewMatchPlatformIgdbId` and `reviewMatchMobygamesGameId` when available

That means automatic enrichment can refresh missing or stale metadata without discarding the saved manual match.

### Pricing lock

Locked pricing rows also continue to refresh automatically.

The pricing lock preserves the saved PSPrices match context used for refresh, such as `psPricesMatchQueryTitle` and `psPricesUrl`, so automatic refresh can update price data without discarding the saved manual match.

## When changes take effect

### Immediate effects

These happen as soon as the save or clear request succeeds:

- the discovery row payload is updated in the database
- the modal detail is refreshed from the returned server payload
- the visible row on the admin list is updated immediately
- provider status badges change immediately if the saved fields changed the computed state

### Effects on later sync and merges

Server sync preserves the manual match and lock-related fields during upserts. That means later row merges do not casually discard the manual override fields.

### Effects on later automatic enrichment

- a saved manual HLTB match keeps later refreshes anchored to the saved HLTB lookup context
- a saved manual review match keeps later refreshes anchored to the saved review lookup context
- a saved manual pricing match keeps later refreshes anchored to the saved PSPrices lookup context
- clearing a provider removes that saved match context and allows future automation to find a new one

### Effects of resetting permanent miss

Resetting permanent miss only changes retry state. It does not fetch new metadata by itself.

To make the reset matter immediately, queue a targeted discovery enrichment run or wait for the next scheduled enrichment cycle.

### Effects of queueing enrichment

Queueing enrichment does not itself change the row. The row only changes when the background worker later processes the targeted discovery enrichment job successfully.

Because the queue uses deduplication, a button press can legitimately result in no newly queued job if an equivalent run is already pending.

## Provider-specific caveats

### HLTB matched does not require every timing field

HLTB is treated as matched if any one of the timing fields exists. A partial manual save is therefore enough to remove the row from the HLTB unmatched view.

### Review matched is based on review data, not every review field

Review can become matched with a minimal valid review payload, especially for Metacritic-backed data.

### Pricing retry state is visible but not resettable here

Pricing rows can surface as `retrying` or `permanentMiss` when PSPrices retry metadata exists for a supported pricing platform.

Unlike HLTB and review, the admin page does not expose a `Clear visible permanent misses` reset path for pricing. Pricing repair flows on this page are manual save/clear and pricing requeue actions.

### Pricing requeue complements manual pricing repair

If the selected problem is pricing-only, the direct repair paths are manual save/clear and pricing requeue actions. The pricing queue path schedules Steam or PSPrices refresh work, while HLTB and review queue actions schedule discovery enrichment.

## Practical triage examples

### A row is in `permanentMiss` for review

1. Filter provider to `Review` and state to `Permanent miss`.
2. Open the row and inspect its details.
3. Either save a manual review match, or clear visible permanent misses.
4. If you cleared permanent miss and want an immediate retry, queue the row or the visible results.

### A row has a bad manual HLTB match

1. Open the row.
2. Search HLTB candidates or edit the fields manually.
3. Save the corrected HLTB match.

The save updates the row immediately and keeps it locked so the discovery worker does not overwrite it.

### A row has stale manual pricing data

1. Open the row and review the pricing fields.
2. Either overwrite them with a new manual pricing match or clear pricing.

If pricing remains locked, automatic PSPrices refresh will continue to skip that row.
