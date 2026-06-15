import { Injectable, computed, signal } from '@angular/core';

export type SyncBootstrapPhase = 'idle' | 'games' | 'metadata';

export interface SyncBootstrapProgressState {
  active: boolean;
  phase: SyncBootstrapPhase;
  gamesLoaded: number;
  gamesTotal: number | null;
}

const IDLE_STATE: SyncBootstrapProgressState = {
  active: false,
  phase: 'idle',
  gamesLoaded: 0,
  gamesTotal: null,
};

@Injectable({ providedIn: 'root' })
export class SyncBootstrapProgressService {
  private readonly state = signal<SyncBootstrapProgressState>(IDLE_STATE);

  readonly progress = this.state.asReadonly();

  readonly message = computed((): string => {
    const current = this.state();

    if (!current.active) {
      return '';
    }

    if (current.phase === 'metadata') {
      return 'Applying tags, views, and settings…';
    }

    const loadedLabel = formatCount(current.gamesLoaded);

    if (current.gamesTotal !== null && current.gamesTotal > 0) {
      return `Loading library… ${loadedLabel} / ${formatCount(current.gamesTotal)} games`;
    }

    if (current.gamesLoaded > 0) {
      return `Loading library… ${loadedLabel} games`;
    }

    return 'Loading library…';
  });

  readonly progressRatio = computed((): number | null => {
    const current = this.state();

    if (
      !current.active ||
      current.phase !== 'games' ||
      current.gamesTotal === null ||
      current.gamesTotal <= 0
    ) {
      return null;
    }

    return Math.min(1, current.gamesLoaded / current.gamesTotal);
  });

  start(): void {
    this.state.set({
      active: true,
      phase: 'games',
      gamesLoaded: 0,
      gamesTotal: null,
    });
  }

  setGamesTotal(gamesTotal: number | null): void {
    const normalized =
      typeof gamesTotal === 'number' && Number.isFinite(gamesTotal) && gamesTotal >= 0
        ? Math.trunc(gamesTotal)
        : null;

    this.state.update((current) => ({
      ...current,
      gamesTotal: normalized,
    }));
  }

  updateGamesLoaded(gamesLoaded: number): void {
    const normalized =
      typeof gamesLoaded === 'number' && Number.isFinite(gamesLoaded) && gamesLoaded >= 0
        ? Math.trunc(gamesLoaded)
        : 0;

    this.state.update((current) => ({
      ...current,
      phase: 'games',
      gamesLoaded: normalized,
    }));
  }

  startMetadataPhase(): void {
    this.state.update((current) => ({
      ...current,
      phase: 'metadata',
    }));
  }

  finish(): void {
    this.state.set(IDLE_STATE);
  }

  async waitUntilIdle(): Promise<void> {
    while (this.state().active) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}
