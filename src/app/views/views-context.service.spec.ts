import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ViewsContextService } from './views-context.service';
import { DEFAULT_GAME_LIST_FILTERS } from '../core/models/game.models';

describe('ViewsContextService', () => {
  let service: ViewsContextService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ViewsContextService);
  });

  it('consume returns default context when nothing was set', () => {
    const ctx = service.consume();
    expect(ctx.listType).toBe('collection');
    expect(ctx.groupBy).toBe('none');
    expect(ctx.filters).toEqual(DEFAULT_GAME_LIST_FILTERS);
  });

  it('consume returns set context and clears it', () => {
    service.set({
      listType: 'wishlist',
      filters: { ...DEFAULT_GAME_LIST_FILTERS },
      groupBy: 'status',
    });
    const first = service.consume();
    expect(first.listType).toBe('wishlist');
    expect(first.groupBy).toBe('status');

    const second = service.consume();
    expect(second.listType).toBe('collection');
  });
});
