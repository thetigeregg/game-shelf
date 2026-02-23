import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { GameCatalogPlatformOption } from '../models/game.models';
import { PLATFORM_CATALOG } from '../data/platform-catalog';

export const PLATFORM_ORDER_STORAGE_KEY = 'game-shelf:platform-display-order-v1';

@Injectable({ providedIn: 'root' })
export class PlatformOrderService {
  private readonly orderSubject = new BehaviorSubject<string[]>(this.loadOrderFromStorage());
  private readonly defaultOrder = [...PLATFORM_CATALOG]
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }

      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    })
    .map((item) => item.name);
  readonly order$ = this.orderSubject.asObservable();

  getOrder(): string[] {
    return [...this.orderSubject.value];
  }

  getDefaultOrder(): string[] {
    return [...this.defaultOrder];
  }

  getEffectiveOrder(): string[] {
    const custom = this.orderSubject.value;
    return custom.length > 0 ? [...custom] : [...this.defaultOrder];
  }

  setOrder(platformNames: string[]): void {
    const normalized = this.normalizeOrder(platformNames);
    this.orderSubject.next(normalized);
    this.saveOrderToStorage(normalized);
  }

  clearOrder(): void {
    this.orderSubject.next([]);

    try {
      localStorage.removeItem(PLATFORM_ORDER_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  refreshFromStorage(): void {
    this.orderSubject.next(this.loadOrderFromStorage());
  }

  comparePlatformNames(left: string, right: string): number {
    return this.comparePlatformNamesByOrder(left, right, this.getDefaultOrder());
  }

  comparePlatformNamesByCustomOrder(left: string, right: string): number {
    return this.comparePlatformNamesByOrder(left, right, this.getEffectiveOrder());
  }

  sortPlatformNamesByCustomOrder(platformNames: string[]): string[] {
    const deduped = [
      ...new Set(
        platformNames.map((name) => String(name ?? '').trim()).filter((name) => name.length > 0)
      )
    ];

    return deduped.sort((left, right) => this.comparePlatformNamesByCustomOrder(left, right));
  }

  sortPlatformNames(platformNames: string[]): string[] {
    const deduped = [
      ...new Set(
        platformNames.map((name) => String(name ?? '').trim()).filter((name) => name.length > 0)
      )
    ];

    return deduped.sort((left, right) => this.comparePlatformNames(left, right));
  }

  sortPlatformOptions(options: GameCatalogPlatformOption[]): GameCatalogPlatformOption[] {
    const deduped = options.filter((option, index, all) => {
      return (
        all.findIndex(
          (candidate) => candidate.id === option.id && candidate.name === option.name
        ) === index
      );
    });

    return [...deduped].sort((left, right) => this.comparePlatformNames(left.name, right.name));
  }

  sortPlatformOptionsByCustomOrder(
    options: GameCatalogPlatformOption[]
  ): GameCatalogPlatformOption[] {
    const deduped = options.filter((option, index, all) => {
      return (
        all.findIndex(
          (candidate) => candidate.id === option.id && candidate.name === option.name
        ) === index
      );
    });

    return [...deduped].sort((left, right) =>
      this.comparePlatformNamesByCustomOrder(left.name, right.name)
    );
  }

  private comparePlatformNamesByOrder(left: string, right: string, order: string[]): number {
    const leftRank = this.getOrderRank(left, order);
    const rightRank = this.getOrderRank(right, order);

    if (leftRank !== null && rightRank !== null && leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (leftRank !== null && rightRank === null) {
      return -1;
    }

    if (leftRank === null && rightRank !== null) {
      return 1;
    }

    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  }

  private getOrderRank(value: string, order: string[]): number | null {
    const key = this.normalizeKey(value);

    for (let index = 0; index < order.length; index += 1) {
      if (this.normalizeKey(order[index]) === key) {
        return index;
      }
    }

    return null;
  }

  private normalizeOrder(platformNames: string[]): string[] {
    return [
      ...new Set(
        platformNames.map((name) => String(name ?? '').trim()).filter((name) => name.length > 0)
      )
    ];
  }

  private normalizeKey(value: string): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private loadOrderFromStorage(): string[] {
    try {
      const raw = localStorage.getItem(PLATFORM_ORDER_STORAGE_KEY);

      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? this.normalizeOrder(parsed as string[]) : [];
    } catch {
      return [];
    }
  }

  private saveOrderToStorage(platformNames: string[]): void {
    try {
      localStorage.setItem(PLATFORM_ORDER_STORAGE_KEY, JSON.stringify(platformNames));
    } catch {
      // Ignore storage failures.
    }
  }
}
