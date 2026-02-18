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
});
