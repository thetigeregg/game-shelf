import { TestBed } from '@angular/core/testing';
import { PlatformOrderService } from './platform-order.service';

describe('PlatformOrderService', () => {
  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [PlatformOrderService]
    });
  });

  it('sorts platform names by default order and ignores custom order', () => {
    const service = TestBed.inject(PlatformOrderService);
    service.setOrder(['PC (Microsoft Windows)', 'Nintendo Switch']);

    expect(
      service.sortPlatformNames(['PlayStation 5', 'PC (Microsoft Windows)', 'Nintendo Switch'])
    ).toEqual(['Nintendo Switch', 'PlayStation 5', 'PC (Microsoft Windows)']);
  });

  it('can sort platform names by custom order when explicitly requested', () => {
    const service = TestBed.inject(PlatformOrderService);
    service.setOrder(['Nintendo Switch', 'PC (Microsoft Windows)']);

    expect(
      service.sortPlatformNamesByCustomOrder([
        'PlayStation 5',
        'PC (Microsoft Windows)',
        'Nintendo Switch'
      ])
    ).toEqual(['Nintendo Switch', 'PC (Microsoft Windows)', 'PlayStation 5']);
  });

  it('uses platform catalog sort_order as default order when no custom order exists', () => {
    const service = TestBed.inject(PlatformOrderService);
    service.clearOrder();
    const input = ['DOS', 'Xbox Series X|S', 'Nintendo 64'];

    const sorted = service.sortPlatformNames(input);
    const expected = service.getDefaultOrder().filter((name) => input.includes(name));

    expect(sorted).toEqual(expected);
  });

  it('persists and loads order from storage', () => {
    const first = TestBed.inject(PlatformOrderService);
    first.setOrder(['Xbox 360', 'PlayStation 3']);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [PlatformOrderService]
    });

    const second = TestBed.inject(PlatformOrderService);
    expect(second.getOrder()).toEqual(['Xbox 360', 'PlayStation 3']);
  });

  it('clears order from memory and storage', () => {
    const service = TestBed.inject(PlatformOrderService);
    service.setOrder(['Nintendo Switch']);
    service.clearOrder();

    expect(service.getOrder()).toEqual([]);
    expect(localStorage.getItem('game-shelf:platform-display-order-v1')).toBeNull();
  });

  it('sorts platform options by custom order and removes duplicate options', () => {
    const service = TestBed.inject(PlatformOrderService);
    service.setOrder(['Nintendo Switch', 'PlayStation 5']);

    const sorted = service.sortPlatformOptionsByCustomOrder([
      { id: 2, name: 'PlayStation 5' },
      { id: 1, name: 'Nintendo Switch' },
      { id: 2, name: 'PlayStation 5' }
    ]);

    expect(sorted).toEqual([
      { id: 1, name: 'Nintendo Switch' },
      { id: 2, name: 'PlayStation 5' }
    ]);
  });

  it('places ranked platforms before unknown names in custom order comparisons', () => {
    const service = TestBed.inject(PlatformOrderService);
    service.setOrder(['Nintendo Switch']);

    expect(service.sortPlatformNamesByCustomOrder(['Unknown Platform', 'Nintendo Switch'])).toEqual(
      ['Nintendo Switch', 'Unknown Platform']
    );
  });

  it('falls back to locale sorting when neither platform name exists in custom order', () => {
    const service = TestBed.inject(PlatformOrderService);
    service.setOrder(['Nintendo Switch']);

    expect(service.sortPlatformNamesByCustomOrder(['zeta', 'Alpha'])).toEqual(['Alpha', 'zeta']);
  });

  it('handles malformed storage data by loading an empty order', () => {
    localStorage.setItem('game-shelf:platform-display-order-v1', '{bad json');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [PlatformOrderService]
    });

    const service = TestBed.inject(PlatformOrderService);
    expect(service.getOrder()).toEqual([]);
  });

  it('can refresh custom order from storage', () => {
    const service = TestBed.inject(PlatformOrderService);
    localStorage.setItem(
      'game-shelf:platform-display-order-v1',
      JSON.stringify(['PlayStation 5', 'Nintendo Switch'])
    );

    service.refreshFromStorage();

    expect(service.getOrder()).toEqual(['PlayStation 5', 'Nintendo Switch']);
  });

  it('returns positive rank when left is unknown and right is ranked', () => {
    const service = TestBed.inject(PlatformOrderService);
    service.setOrder(['Nintendo Switch']);

    expect(service.comparePlatformNamesByCustomOrder('Unknown Platform', 'Nintendo Switch')).toBe(
      1
    );
  });
});
