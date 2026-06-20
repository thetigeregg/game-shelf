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

  it('consume returns default context and hasContext=false when nothing was set', () => {
    const { context, hasContext } = service.consume();
    expect(hasContext).toBe(false);
    expect(context.listType).toBe('collection');
    expect(context.groupBy).toBe('none');
    expect(context.filters).toEqual(DEFAULT_GAME_LIST_FILTERS);
  });

  it('consume returns set context with hasContext=true and clears it', () => {
    service.set({
      listType: 'wishlist',
      filters: { ...DEFAULT_GAME_LIST_FILTERS },
      groupBy: 'status',
    });
    const { context: first, hasContext: firstHas } = service.consume();
    expect(firstHas).toBe(true);
    expect(first.listType).toBe('wishlist');
    expect(first.groupBy).toBe('status');

    const { context: second, hasContext: secondHas } = service.consume();
    expect(secondHas).toBe(false);
    expect(second.listType).toBe('collection');
  });
});
