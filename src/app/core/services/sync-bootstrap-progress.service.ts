import { Injectable, computed, signal } from '@angular/core';

export type SyncBootstrapPhase = 'idle' | 'games';

export interface SyncBootstrapProgressState {
  active: boolean;
  phase: SyncBootstrapPhase;
  gamesLoaded: number;
}

const IDLE_STATE: SyncBootstrapProgressState = {
  active: false,
  phase: 'idle',
  gamesLoaded: 0,
};

@Injectable({ providedIn: 'root' })
export class SyncBootstrapProgressService {
  private readonly state = signal<SyncBootstrapProgressState>(IDLE_STATE);
  private readonly idleWaiters = new Set<() => void>();

  readonly progress = this.state.asReadonly();

  readonly message = computed((): string => {
    const current = this.state();

    if (!current.active) {
      return '';
    }

    const loadedLabel = formatCount(current.gamesLoaded);

    if (current.gamesLoaded > 0) {
      return `Loading library… ${loadedLabel} games`;
    }

    return 'Loading library…';
  });

  start(): void {
    this.state.set({
      active: true,
      phase: 'games',
      gamesLoaded: 0,
    });
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

  finish(): void {
    this.state.set(IDLE_STATE);
    this.idleWaiters.forEach((resolve) => {
      resolve();
    });
    this.idleWaiters.clear();
  }

  waitUntilIdle(): Promise<void> {
    if (!this.state().active) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }
}

const COUNT_FORMATTER = new Intl.NumberFormat();

function formatCount(value: number): string {
  return COUNT_FORMATTER.format(value);
}
