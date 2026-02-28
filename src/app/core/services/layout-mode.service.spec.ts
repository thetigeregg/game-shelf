import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { LayoutModeService } from './layout-mode.service';

describe('LayoutModeService', () => {
  let service: LayoutModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [LayoutModeService] });
    service = TestBed.inject(LayoutModeService);
  });

  it('exposes mode$ observable that emits the current layout mode', async () => {
    const mode = await firstValueFrom(service.mode$);
    expect(['mobile', 'desktop']).toContain(mode);
  });

  it('mode getter returns a valid layout mode', () => {
    expect(['mobile', 'desktop']).toContain(service.mode);
  });

  it('mode getter and mode$ observable agree', async () => {
    const observed = await firstValueFrom(service.mode$);
    expect(service.mode).toBe(observed);
  });
});
