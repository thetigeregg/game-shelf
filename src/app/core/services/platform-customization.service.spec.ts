import { TestBed } from '@angular/core/testing';
import {
  PLATFORM_DISPLAY_NAMES_STORAGE_KEY,
  PlatformCustomizationService,
} from './platform-customization.service';

describe('PlatformCustomizationService', () => {
  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [PlatformCustomizationService],
    });
  });

  it('returns fallback platform name when no custom display name exists', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    expect(service.getDisplayName('Nintendo Switch', 130)).toBe('Nintendo Switch');
  });

  it('applies built-in platform aliases when no custom display name exists', () => {
    const service = TestBed.inject(PlatformCustomizationService);

    expect(service.getDisplayName('Super Famicom', 58)).toBe('Super Nintendo Entertainment System');
    expect(service.getDisplayName('Family Computer Disk System', 51)).toBe('Nintendo Entertainment System');
    expect(service.getDisplayName('e-Reader / Card-e Reader', 510)).toBe('Game Boy Advance');
  });

  it('applies custom display names by platform id', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(130, 'Switch');

    expect(service.getDisplayName('Nintendo Switch', 130)).toBe('Switch');
    expect(service.getDisplayName('Nintendo Switch', 6)).toBe('Nintendo Switch');
  });

  it('applies canonical destination custom names to aliased source platforms', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(99, 'Famicom');
    service.setCustomName(18, 'NES');

    expect(service.getDisplayName('Family Computer', 99)).toBe('NES');
    expect(service.getDisplayName('Family Computer Disk System', 51)).toBe('NES');
    expect(service.getDisplayName('Nintendo Entertainment System', 18)).toBe('NES');
  });

  it('formats aliased labels as canonical with original source in parentheses', () => {
    const service = TestBed.inject(PlatformCustomizationService);

    expect(service.getDisplayNameWithAliasSource('Family Computer', 99)).toBe('Nintendo Entertainment System (Family Computer)');

    service.setCustomName(18, 'NES');
    expect(service.getDisplayNameWithAliasSource('Family Computer', 99)).toBe('NES (Family Computer)');

    service.setCustomName(99, 'Famicom');
    expect(service.getDisplayNameWithAliasSource('Family Computer', 99)).toBe('NES (Famicom)');
  });

  it('returns non-aliased platform labels unchanged for alias-source formatting', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(130, 'Switch');

    expect(service.getDisplayNameWithAliasSource('Nintendo Switch', 130)).toBe('Switch');
    expect(service.getDisplayNameWithAliasSource('Nintendo Switch', 6)).toBe('Nintendo Switch');
  });

  it('removes custom display names when set to empty', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(130, 'Switch');
    service.setCustomName(130, '   ');

    expect(service.getCustomName(130)).toBeNull();
    expect(service.getDisplayName('Nintendo Switch', 130)).toBe('Nintendo Switch');
  });

  it('persists and restores display name map from storage', () => {
    const first = TestBed.inject(PlatformCustomizationService);
    first.setDisplayNames({ '130': 'Switch', '19': 'SNES' });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [PlatformCustomizationService],
    });

    const second = TestBed.inject(PlatformCustomizationService);
    expect(second.getDisplayName('Nintendo Switch', 130)).toBe('Switch');
    expect(second.getDisplayName('Super Nintendo Entertainment System', 19)).toBe('SNES');
  });

  it('clears custom names from memory and storage', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(130, 'Switch');
    service.clearCustomNames();

    expect(service.getDisplayNames()).toEqual({});
    expect(localStorage.getItem(PLATFORM_DISPLAY_NAMES_STORAGE_KEY)).toBeNull();
  });
});
