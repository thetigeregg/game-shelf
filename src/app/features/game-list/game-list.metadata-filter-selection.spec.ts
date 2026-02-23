import { GameListComponent } from './game-list.component';

describe('GameListComponent genre metadata selection', () => {
  it('opens genre selector from detail when a selected game exists', () => {
    const openMetadataFilterSelection = vi.fn().mockResolvedValue(undefined);
    const selectedGame = {
      genres: ['RPG']
    };
    const componentLike = {
      selectedGame,
      onGenreItemClick: GameListComponent.prototype.onGenreItemClick,
      openMetadataFilterSelection
    };

    GameListComponent.prototype.onDetailGenreClick.call(componentLike);

    expect(openMetadataFilterSelection).toHaveBeenCalledWith('genre', ['RPG'], 'Select Genre');
  });

  it('emits a normalized genre metadata filter selection', () => {
    const closeGameDetailModal = vi.fn();
    const emit = vi.fn();
    const componentLike = {
      closeGameDetailModal,
      metadataFilterSelected: {
        emit
      }
    };

    (GameListComponent.prototype as any).applyMetadataFilterSelection.call(
      componentLike,
      'genre',
      '  Action  '
    );

    expect(closeGameDetailModal).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ kind: 'genre', value: 'Action' });
  });
});
