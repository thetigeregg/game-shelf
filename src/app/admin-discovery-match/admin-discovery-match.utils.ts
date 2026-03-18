import type {
  HltbMatchCandidate,
  PriceMatchCandidate,
  ReviewMatchCandidate,
} from '../core/models/game.models';
import type {
  AdminDiscoveryListItem,
  AdminDiscoveryMatchProvider,
  AdminDiscoveryMatchState,
  AdminDiscoveryMatchStateStatus,
} from '../core/services/admin-discovery-match.service';

export type QueueStatusTone = 'success' | 'warning' | 'danger';

export interface GroupedAdminDiscoveryListItem extends AdminDiscoveryListItem {
  gameKeys: string[];
  platformLabels: string[];
  groupedPlatformCount: number;
  sourceItems: AdminDiscoveryListItem[];
}

export function getAdminDiscoveryGameKey(
  item: Pick<AdminDiscoveryListItem, 'igdbGameId' | 'platformIgdbId'>
): string {
  return `${item.igdbGameId}::${String(item.platformIgdbId)}`;
}

export function groupAdminDiscoveryItems(
  items: AdminDiscoveryListItem[]
): GroupedAdminDiscoveryListItem[] {
  const groups = new Map<string, AdminDiscoveryListItem[]>();

  for (const item of items) {
    const existing = groups.get(item.igdbGameId);
    if (existing) {
      existing.push(item);
      continue;
    }
    groups.set(item.igdbGameId, [item]);
  }

  return [...groups.values()].map((group) => buildGroupedAdminDiscoveryItem(group));
}

export function buildGroupedAdminDiscoveryItem(
  group: AdminDiscoveryListItem[]
): GroupedAdminDiscoveryListItem {
  const representative = group[0];
  const platformLabels = [
    ...new Set(
      group.map((item) => item.platform?.trim()).filter((value): value is string => !!value)
    ),
  ];

  return {
    ...representative,
    platform: group.length > 1 ? 'Multiple platforms' : representative.platform,
    matchState: aggregateAdminDiscoveryMatchState(group),
    gameKeys: group.map((item) => getAdminDiscoveryGameKey(item)),
    platformLabels,
    groupedPlatformCount: group.length,
    sourceItems: group.map((item) => ({ ...item })),
  };
}

export function aggregateAdminDiscoveryMatchState(
  group: AdminDiscoveryListItem[]
): AdminDiscoveryMatchState {
  return {
    hltb: aggregateAdminDiscoveryProviderState(group, 'hltb'),
    review: aggregateAdminDiscoveryProviderState(group, 'review'),
    pricing: aggregateAdminDiscoveryProviderState(group, 'pricing'),
  };
}

function aggregateAdminDiscoveryProviderState(
  group: AdminDiscoveryListItem[],
  provider: AdminDiscoveryMatchProvider
) {
  const states = group.map((item) => item.matchState[provider]);
  const status = aggregateAdminDiscoveryStatus(states.map((state) => state.status));

  return {
    status,
    locked: states.every((state) => state.locked),
    attempts: Math.max(...states.map((state) => state.attempts)),
    lastTriedAt: pickLatestIso(states.map((state) => state.lastTriedAt)),
    nextTryAt: pickLatestIso(states.map((state) => state.nextTryAt)),
    permanentMiss: states.some((state) => state.permanentMiss),
  };
}

function aggregateAdminDiscoveryStatus(
  statuses: AdminDiscoveryMatchStateStatus[]
): AdminDiscoveryMatchStateStatus {
  if (statuses.some((status) => status === 'permanentMiss')) {
    return 'permanentMiss';
  }
  if (statuses.some((status) => status === 'retrying')) {
    return 'retrying';
  }
  if (statuses.some((status) => status === 'missing')) {
    return 'missing';
  }
  return 'matched';
}

function pickLatestIso(values: Array<string | null>): string | null {
  const normalized = values.filter((value): value is string => typeof value === 'string');
  if (normalized.length === 0) {
    return null;
  }

  return normalized.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

export function resolveAdminPricingSource(
  platformIgdbId: number | null | undefined,
  priceSource?: string | null
): 'steam_store' | 'psprices' {
  if (priceSource === 'steam_store' || priceSource === 'psprices') {
    return priceSource;
  }

  return platformIgdbId === 6 ? 'steam_store' : 'psprices';
}

export function buildAdminQueueFeedback(
  response: { queued: boolean; deduped: boolean; queuedCount: number; dedupedCount: number },
  provider: AdminDiscoveryMatchProvider,
  scope: 'list' | 'active'
): { message: string; tone: QueueStatusTone } {
  const pricing = provider === 'pricing';

  if (response.queuedCount === 0 && response.dedupedCount === 0) {
    return {
      message: pricing
        ? 'No eligible pricing refresh jobs were queued.'
        : 'No eligible discovery enrichment jobs were queued.',
      tone: 'warning',
    };
  }

  if (response.deduped) {
    return {
      message: pricing
        ? 'Targeted pricing refresh is already queued.'
        : 'Targeted discovery enrichment is already queued.',
      tone: 'warning',
    };
  }

  return {
    message: pricing
      ? `Targeted pricing refresh queued for ${scope === 'list' ? 'the current results' : 'this game'}.`
      : `Targeted discovery enrichment queued for ${scope === 'list' ? 'the current results' : 'this game'}.`,
    tone: 'success',
  };
}

export function describeAdminTargetedRows(items: GroupedAdminDiscoveryListItem[]): string | null {
  if (items.length === 0) {
    return null;
  }

  const labels = items
    .slice(0, 3)
    .map((item) => describeAdminRow(item))
    .filter((label) => label.length > 0);

  if (labels.length === 0) {
    return `${String(items.length)} game${items.length === 1 ? '' : 's'} targeted.`;
  }

  const suffix =
    items.length > labels.length ? `, +${String(items.length - labels.length)} more` : '';
  return `${String(items.length)} game${items.length === 1 ? '' : 's'} targeted: ${labels.join(', ')}${suffix}`;
}

export function describeAdminActiveTarget(
  activeDetail: Pick<AdminDiscoveryListItem, 'title' | 'platform' | 'releaseYear'> | null,
  activeGroup: Pick<GroupedAdminDiscoveryListItem, 'groupedPlatformCount'> | null
): string | null {
  if (!activeDetail) {
    return null;
  }

  if (activeGroup && activeGroup.groupedPlatformCount > 1) {
    return `Targeted game: ${describeAdminRow({
      title: activeDetail.title,
      platform: 'Multiple platforms',
      releaseYear: activeDetail.releaseYear,
    })}`;
  }

  return `Targeted row: ${describeAdminRow(activeDetail)}`;
}

export function describeAdminRow(
  item: Pick<AdminDiscoveryListItem, 'title' | 'platform' | 'releaseYear'>
): string {
  const title = item.title?.trim() || 'Untitled discovery game';
  const platform = item.platform?.trim();
  const year = item.releaseYear;

  const meta = [
    platform && platform.length > 0 ? platform : null,
    year ? String(year) : null,
  ].filter((value): value is string => value !== null);

  return meta.length > 0 ? `${title} (${meta.join(', ')})` : title;
}

export function dedupeHltbAdminCandidates(candidates: HltbMatchCandidate[]): HltbMatchCandidate[] {
  const byKey = new Map<string, HltbMatchCandidate>();

  candidates.forEach((candidate) => {
    const key = `${candidate.title}::${String(candidate.releaseYear ?? '')}::${candidate.platform ?? ''}::${String(candidate.hltbGameId ?? '')}::${candidate.hltbUrl ?? ''}`;

    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  });

  return [...byKey.values()];
}

export function dedupeReviewAdminCandidates(
  candidates: ReviewMatchCandidate[]
): ReviewMatchCandidate[] {
  const deduped: ReviewMatchCandidate[] = [];

  candidates.forEach((candidate) => {
    const candidateIdentityUrl = candidate.reviewUrl ?? candidate.metacriticUrl ?? '';
    const existingIndex = deduped.findIndex((entry) => {
      if (
        entry.title !== candidate.title ||
        entry.releaseYear !== candidate.releaseYear ||
        entry.platform !== candidate.platform
      ) {
        return false;
      }

      const entryIdentityUrl = entry.reviewUrl ?? entry.metacriticUrl ?? '';
      return (
        entryIdentityUrl === candidateIdentityUrl ||
        entryIdentityUrl.length === 0 ||
        candidateIdentityUrl.length === 0
      );
    });

    if (existingIndex === -1) {
      deduped.push(candidate);
      return;
    }

    const existing = deduped[existingIndex];
    const existingIdentityUrl = existing.reviewUrl ?? existing.metacriticUrl ?? '';
    const existingScore = existing.reviewScore ?? existing.metacriticScore ?? null;
    const candidateScore = candidate.reviewScore ?? candidate.metacriticScore ?? null;
    const wouldDropIdentityUrl =
      existingIdentityUrl.length > 0 && candidateIdentityUrl.length === 0;
    const gainsIdentityUrl = existingIdentityUrl.length === 0 && candidateIdentityUrl.length > 0;
    const shouldReplace =
      !wouldDropIdentityUrl &&
      (gainsIdentityUrl ||
        (existing.imageUrl == null && candidate.imageUrl != null) ||
        (existingScore == null && candidateScore != null));

    if (shouldReplace) {
      deduped[existingIndex] = candidate;
    }
  });

  return deduped;
}

export function dedupePricingAdminCandidates(
  candidates: PriceMatchCandidate[]
): PriceMatchCandidate[] {
  const byKey = new Map<string, PriceMatchCandidate>();

  candidates.forEach((candidate) => {
    const key = `${candidate.title}::${candidate.url ?? ''}::${String(candidate.amount ?? '')}`;
    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  });

  return [...byKey.values()];
}

export function parseAdminInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }
  return Number.parseInt(normalized, 10);
}

export function parseAdminNumber(value: string): number | null {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeAdminString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function formatAdminNumber(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
