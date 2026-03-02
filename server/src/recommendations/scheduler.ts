import type { RecommendationService } from './service.js';
import { RecommendationTarget } from './types.js';

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
const TARGETS: RecommendationTarget[] = ['BACKLOG', 'WISHLIST'];

export class RecommendationScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly service: RecommendationService,
    private readonly options: {
      enabled: boolean;
    }
  ) {}

  start(): void {
    if (!this.options.enabled || this.intervalHandle) {
      return;
    }

    this.runTick();

    this.intervalHandle = setInterval(() => {
      this.runTick();
    }, SCHEDULER_INTERVAL_MS);
  }

  stop(): void {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  private runTick(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    void this.runOnce().finally(() => {
      this.isRunning = false;
    });
  }

  private async runOnce(): Promise<void> {
    for (const target of TARGETS) {
      try {
        await this.service.rebuildIfStale(target, 'scheduler');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[recommendations] scheduler_tick_failed', {
          target,
          message
        });
      }
    }
  }
}
