import { GameDetailContentComponent } from './game-detail-content.component';

describe('GameDetailContentComponent genre metadata click', () => {
  it('emits genreClick in library context when genres are present', () => {
    const genreClick = { emit: vi.fn() };
    const componentLike = {
      context: 'library',
      game: {
        genres: [' Action ']
      },
      genreClick,
      hasMetadataValue: GameDetailContentComponent.prototype.hasMetadataValue
    };

    GameDetailContentComponent.prototype.onGenreClick.call(componentLike);

    expect(genreClick.emit).toHaveBeenCalledTimes(1);
  });

  it('does not emit genreClick when no genre metadata is available', () => {
    const genreClick = { emit: vi.fn() };
    const componentLike = {
      context: 'library',
      game: {
        genres: [' ', '']
      },
      genreClick,
      hasMetadataValue: GameDetailContentComponent.prototype.hasMetadataValue
    };

    GameDetailContentComponent.prototype.onGenreClick.call(componentLike);

    expect(genreClick.emit).not.toHaveBeenCalled();
  });
});
