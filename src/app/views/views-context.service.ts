import { Injectable } from '@angular/core';
import {
  DEFAULT_GAME_LIST_FILTERS,
  GameGroupByField,
  GameListFilters,
  ListType,
} from '../core/models/game.models';

export interface ViewsNavigationContext {
  listType: ListType;
  filters: GameListFilters;
  groupBy: GameGroupByField;
}

@Injectable({ providedIn: 'root' })
export class ViewsContextService {
  private context: ViewsNavigationContext | null = null;

  set(context: ViewsNavigationContext): void {
    this.context = context;
  }

  consume(): ViewsNavigationContext {
    const ctx = this.context;
    this.context = null;
    return (
      ctx ?? {
        listType: 'collection',
        filters: { ...DEFAULT_GAME_LIST_FILTERS },
        groupBy: 'none',
      }
    );
  }
}
