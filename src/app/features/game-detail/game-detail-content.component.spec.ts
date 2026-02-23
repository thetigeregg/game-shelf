import { canOpenMetadataFilter } from './game-detail-metadata.utils';

describe('game detail metadata interactions', () => {
  it('opens genre metadata filter in library context when genres are present', () => {
    expect(canOpenMetadataFilter(true, [' Action '])).toBe(true);
  });

  it('does not open genre metadata filter when genre metadata is missing', () => {
    expect(canOpenMetadataFilter(true, [' ', ''])).toBe(false);
  });
});
