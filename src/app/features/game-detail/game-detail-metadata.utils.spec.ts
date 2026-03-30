import { canOpenMetadataFilter } from './game-detail-metadata.utils';

describe('game-detail metadata utils', () => {
  it('allows opening metadata filter when in library and genre is present', () => {
    expect(canOpenMetadataFilter(true, true, ['  Action '])).toBe(true);
  });

  it('prevents opening metadata filter when metadata values are empty', () => {
    expect(canOpenMetadataFilter(true, true, [' ', ''])).toBe(false);
  });

  it('prevents opening metadata filter outside library context', () => {
    expect(canOpenMetadataFilter(false, true, ['RPG'])).toBe(false);
  });

  it('prevents opening metadata filter when links are disabled', () => {
    expect(canOpenMetadataFilter(true, false, ['RPG'])).toBe(false);
  });

  it('prevents opening metadata filter when metadata is not an array', () => {
    expect(canOpenMetadataFilter(true, true, undefined)).toBe(false);
  });
});
