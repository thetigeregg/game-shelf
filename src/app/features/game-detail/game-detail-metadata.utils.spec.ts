import { canOpenMetadataFilter } from './game-detail-metadata.utils';

describe('game-detail metadata utils', () => {
  it('allows opening metadata filter when in library and genre is present', () => {
    expect(canOpenMetadataFilter(true, ['  Action '])).toBe(true);
  });

  it('prevents opening metadata filter when metadata values are empty', () => {
    expect(canOpenMetadataFilter(true, [' ', ''])).toBe(false);
  });

  it('prevents opening metadata filter outside library context', () => {
    expect(canOpenMetadataFilter(false, ['RPG'])).toBe(false);
  });
});
