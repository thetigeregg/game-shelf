import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { SyncBootstrapProgressService } from './sync-bootstrap-progress.service';

describe('SyncBootstrapProgressService', () => {
  let service: SyncBootstrapProgressService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SyncBootstrapProgressService);
  });

  it('starts idle and exposes progress messages for each phase', () => {
    expect(service.progress().active).toBe(false);

    service.start();
    expect(service.progress().active).toBe(true);
    expect(service.message()).toBe('Downloading library…');

    service.setGamesTotal(3200);
    service.updateGamesLoaded(500);
    expect(service.message()).toBe('Downloading library… 500 / 3,200 games');
    expect(service.progressRatio()).toBeCloseTo(500 / 3200);

    service.startMetadataPhase();
    expect(service.message()).toBe('Applying tags, views, and settings…');
    expect(service.progressRatio()).toBeNull();

    service.finish();
    expect(service.progress().active).toBe(false);
    expect(service.message()).toBe('');
  });

  it('shows loaded count without total when gamesTotal is unknown', () => {
    service.start();
    service.updateGamesLoaded(750);

    expect(service.message()).toBe('Downloading library… 750 games');
    expect(service.progressRatio()).toBeNull();
  });

  it('waitUntilIdle resolves immediately when bootstrap is not active', async () => {
    await expect(service.waitUntilIdle()).resolves.toBeUndefined();
  });

  it('waitUntilIdle resolves after bootstrap finishes', async () => {
    service.start();

    const idlePromise = service.waitUntilIdle();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(service.progress().active).toBe(true);
    service.finish();
    await expect(idlePromise).resolves.toBeUndefined();
  });
});
