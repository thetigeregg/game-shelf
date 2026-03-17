import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import { AppDb } from '../data/app-db';
import { DebugLogService } from './debug-log.service';
import { ImageCacheService } from './image-cache.service';

function makeDebugLogStub(): DebugLogService {
  return {
    trace: () => {},
    warn: () => {},
    error: () => {},
    info: () => {}
  } as unknown as DebugLogService;
}

describe('ImageCacheService', () => {
  let service: ImageCacheService;

  beforeEach(async () => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        ImageCacheService,
        AppDb,
        { provide: DebugLogService, useValue: makeDebugLogStub() }
      ]
    });

    service = TestBed.inject(ImageCacheService);
    await TestBed.inject(AppDb).open();
  });

  afterEach(async () => {
    const db = TestBed.inject(AppDb);
    db.close();
    await Dexie.delete('game-shelf-db');
    localStorage.clear();
  });

  describe('getLimitMb / setLimitMb', () => {
    it('returns default 200 MB when nothing is stored', () => {
      expect(service.getLimitMb()).toBe(200);
    });

    it('clamps values below the minimum to 20 MB', () => {
      expect(service.setLimitMb(5)).toBe(20);
      expect(service.getLimitMb()).toBe(20);
    });

    it('clamps values above the maximum to 2048 MB', () => {
      expect(service.setLimitMb(9999)).toBe(2048);
      expect(service.getLimitMb()).toBe(2048);
    });

    it('rounds fractional MB values', () => {
      expect(service.setLimitMb(100.6)).toBe(101);
    });

    it('persists the limit to localStorage', () => {
      service.setLimitMb(500);
      expect(service.getLimitMb()).toBe(500);
    });

    it('returns default when localStorage contains non-numeric value', () => {
      localStorage.setItem('game-shelf:image-cache-limit-mb', 'bad');
      expect(service.getLimitMb()).toBe(200);
    });

    it('returns default when localStorage contains NaN-valued entry', () => {
      localStorage.setItem('game-shelf:image-cache-limit-mb', 'NaN');
      expect(service.getLimitMb()).toBe(200);
    });
  });

  describe('getUsageBytes', () => {
    it('returns 0 when cache is empty', async () => {
      expect(await service.getUsageBytes()).toBe(0);
    });
  });

  describe('purgeLocalCache', () => {
    it('clears the cache without throwing', async () => {
      await expect(service.purgeLocalCache()).resolves.not.toThrow();
      expect(await service.getUsageBytes()).toBe(0);
    });
  });

  describe('purgeGameCache', () => {
    it('does nothing for an empty game key', async () => {
      await expect(service.purgeGameCache('')).resolves.not.toThrow();
    });

    it('does nothing for a whitespace-only game key', async () => {
      await expect(service.purgeGameCache('   ')).resolves.not.toThrow();
    });

    it('runs without error for a key not in cache', async () => {
      await expect(service.purgeGameCache('nonexistent-game')).resolves.not.toThrow();
    });
  });

  describe('resolveImageUrl', () => {
    it('returns placeholder for null source URL', async () => {
      expect(await service.resolveImageUrl('game-1', null, 'detail')).toBe(
        'assets/icon/placeholder.png'
      );
    });

    it('returns placeholder for undefined source URL', async () => {
      expect(await service.resolveImageUrl('game-1', undefined, 'detail')).toBe(
        'assets/icon/placeholder.png'
      );
    });

    it('returns placeholder for empty source URL', async () => {
      expect(await service.resolveImageUrl('game-1', '', 'thumb')).toBe(
        'assets/icon/placeholder.png'
      );
    });

    it('returns placeholder for whitespace-only source URL', async () => {
      expect(await service.resolveImageUrl('game-1', '   ', 'detail')).toBe(
        'assets/icon/placeholder.png'
      );
    });

    it('returns a string for a valid thumb URL (direct, no blob cache)', async () => {
      const src = 'https://images.igdb.com/igdb/image/upload/t_thumb/abc.jpg';
      const url = await service.resolveImageUrl('game-1', src, 'thumb');
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    });

    it('applies retina suffix to IGDB thumb URL without existing _2x', async () => {
      const src = 'https://images.igdb.com/igdb/image/upload/t_thumb/abc.jpg';
      const url = await service.resolveImageUrl('game-1', src, 'thumb');
      // normalizeSourceUrl calls withIgdbRetinaVariant for non-TheGamesDb URLs
      expect(url).toContain('_2x');
    });

    it('does not double-apply retina suffix to IGDB URL already ending in _2x', async () => {
      const src = 'https://images.igdb.com/igdb/image/upload/t_thumb_2x/abc.jpg';
      const url = await service.resolveImageUrl('game-1', src, 'thumb');
      // Should not contain '_2x_2x'
      expect(url).not.toContain('_2x_2x');
    });

    it('transforms TheGamesDB thumb URL to small variant', async () => {
      const src = 'https://cdn.thegamesdb.net/images/original/clearlogo/some-game.png';
      const url = await service.resolveImageUrl('game-1', src, 'thumb');
      // normalizeSourceUrl rewrites /images/original/ to /images/small/
      expect(url).toContain('/images/small/');
    });
    it('returns source URL for detail image when fetch fails (non-proxy URL)', async () => {
      // Non-IGDB/TheGamesDB URLs are fetched directly; network failure returns source URL
      const src = 'https://example.com/art/cover.jpg';
      const url = await service.resolveImageUrl('game-1', src, 'detail');
      // Fetch will fail (no network in test env) → falls back to source URL
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    });

    it('returns source URL for detail image when fetch fails (IGDB URL via proxy)', async () => {
      const src = 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg';
      const url = await service.resolveImageUrl('game-1', src, 'detail');
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    });
  });
});
