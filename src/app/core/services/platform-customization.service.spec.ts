import { TestBed } from '@angular/core/testing';
import {
  PLATFORM_DISPLAY_NAMES_STORAGE_KEY,
  PlatformCustomizationService
} from './platform-customization.service';

const PLATFORM_ALIAS_CASES: Array<{
  source: string;
  id: number | null;
  canonical: string;
  canonicalId: number;
}> = [
  {
    source: 'Family Computer',
    id: 99,
    canonical: 'Nintendo Entertainment System',
    canonicalId: 18
  },
  {
    source: 'Family Computer Disk System',
    id: 51,
    canonical: 'Nintendo Entertainment System',
    canonicalId: 18
  },
  {
    source: 'Super Famicom',
    id: 58,
    canonical: 'Super Nintendo Entertainment System',
    canonicalId: 19
  },
  { source: 'New Nintendo 3DS', id: 137, canonical: 'Nintendo 3DS', canonicalId: 37 },
  { source: 'Nintendo DSi', id: 159, canonical: 'Nintendo DS', canonicalId: 20 },
  { source: 'e-Reader', id: null, canonical: 'Game Boy Advance', canonicalId: 24 },
  { source: 'e-Reader / Card-e Reader', id: 510, canonical: 'Game Boy Advance', canonicalId: 24 }
];

describe('PlatformCustomizationService', () => {
  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [PlatformCustomizationService]
    });
  });

  it('returns fallback platform name when no custom display name exists', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    expect(service.getDisplayName('Nintendo Switch', 130)).toBe('Nintendo Switch');
  });

  it('applies built-in platform aliases when no custom display name exists', () => {
    const service = TestBed.inject(PlatformCustomizationService);

    for (const testCase of PLATFORM_ALIAS_CASES) {
      expect(service.getDisplayName(testCase.source, testCase.id)).toBe(testCase.canonical);
    }
  });

  it('applies custom display names by platform id', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(130, 'Switch');

    expect(service.getDisplayName('Nintendo Switch', 130)).toBe('Switch');
    expect(service.getDisplayName('Nintendo Switch', 6)).toBe('Nintendo Switch');
  });

  it('returns custom name or raw fallback when aliasing is disabled', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(130, 'Switch');
    service.setCustomName(18, 'NES');

    expect(service.getDisplayNameWithoutAlias('Nintendo Switch', 130)).toBe('Switch');
    expect(service.getDisplayNameWithoutAlias('Family Computer', 99)).toBe('Family Computer');
    expect(service.getDisplayNameWithoutAlias('Nintendo Entertainment System', 18)).toBe('NES');
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

    for (const testCase of PLATFORM_ALIAS_CASES) {
      if (testCase.id === null) {
        continue;
      }

      expect(service.getDisplayNameWithAliasSource(testCase.source, testCase.id)).toBe(
        `${testCase.canonical} (${testCase.source})`
      );
    }

    service.setCustomName(18, 'NES');
    expect(service.getDisplayNameWithAliasSource('Family Computer', 99)).toBe(
      'NES (Family Computer)'
    );

    service.setCustomName(99, 'Famicom');
    expect(service.getDisplayNameWithAliasSource('Family Computer', 99)).toBe('NES (Famicom)');
  });

  it('uses platform id alias mapping for alias-source formatting when display name is a nickname', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(510, 'e-Reader');

    expect(service.getDisplayNameWithAliasSource('e-Reader', 510)).toBe(
      'Game Boy Advance (e-Reader)'
    );
  });

  it('returns raw alias source labels when aliasing is disabled', () => {
    const service = TestBed.inject(PlatformCustomizationService);

    for (const testCase of PLATFORM_ALIAS_CASES) {
      if (testCase.id === null) {
        continue;
      }

      expect(service.getDisplayNameWithoutAlias(testCase.source, testCase.id)).toBe(
        testCase.source
      );
    }
  });

  it('returns non-aliased platform labels unchanged for alias-source formatting', () => {
    const service = TestBed.inject(PlatformCustomizationService);
    service.setCustomName(130, 'Switch');

    expect(service.getDisplayNameWithAliasSource('Nintendo Switch', 130)).toBe('Switch');
    expect(service.getDisplayNameWithAliasSource('Nintendo Switch', 6)).toBe('Nintendo Switch');
  });

  it('resolves canonical platform ids for all aliased systems', () => {
    const service = TestBed.inject(PlatformCustomizationService);

    for (const testCase of PLATFORM_ALIAS_CASES) {
      expect(service.resolveCanonicalPlatformIgdbId(testCase.source, testCase.id)).toBe(
        testCase.canonicalId
      );
    }

    expect(service.resolveCanonicalPlatformIgdbId('Nintendo Entertainment System', 18)).toBe(18);
    expect(service.resolveCanonicalPlatformIgdbId('unknown', 9999)).toBeNull();
  });

  it('resolves canonical platform id from alias fallback name when id is missing', () => {
    const service = TestBed.inject(PlatformCustomizationService);

    expect(service.resolveCanonicalPlatformIgdbId('Super Famicom', null)).toBe(19);
    expect(service.resolveCanonicalPlatformIgdbId('Nintendo Switch', null)).toBe(130);
    expect(service.resolveCanonicalPlatformIgdbId('totally unknown platform', null)).toBeNull();
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
      providers: [PlatformCustomizationService]
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
