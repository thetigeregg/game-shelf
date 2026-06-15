import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { SyncBootstrapProgressService } from './sync-bootstrap-progress.service';

const fmt = (n: number) => new Intl.NumberFormat().format(n);

describe('SyncBootstrapProgressService', () => {
  let service: SyncBootstrapProgressService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SyncBootstrapProgressService);
  });

  it('starts idle and tracks games-phase progress', () => {
    expect(service.progress().active).toBe(false);

    service.start();
    expect(service.progress().active).toBe(true);
    expect(service.message()).toBe('Loading library…');

    service.updateGamesLoaded(500);
    expect(service.message()).toBe(`Loading library… ${fmt(500)} games`);

    service.finish();
    expect(service.progress().active).toBe(false);
    expect(service.message()).toBe('');
  });

  it('shows loaded count when games have been loaded', () => {
    service.start();
    service.updateGamesLoaded(750);

    expect(service.message()).toBe('Loading library… 750 games');
  });

  it('uses singular "game" when exactly 1 game has loaded', () => {
    service.start();
    service.updateGamesLoaded(1);

    expect(service.message()).toBe('Loading library… 1 game');
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
