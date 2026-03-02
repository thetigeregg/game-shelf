import { NormalizedGameRecord } from './types.js';

export function buildEmbeddingText(game: NormalizedGameRecord): string {
  const sections: string[] = [];

  sections.push(game.title);

  if (game.summary) {
    sections.push(`Summary: ${game.summary}`);
  }

  if (game.storyline) {
    sections.push(`Storyline: ${game.storyline}`);
  }

  if (game.genres.length > 0) {
    sections.push(`Genres: ${game.genres.join(', ')}`);
  }

  if (game.collections.length > 0) {
    sections.push(`Series: ${game.collections.join(', ')}`);
  }

  if (game.franchises.length > 0) {
    sections.push(`Franchise: ${game.franchises.join(', ')}`);
  }

  if (game.developers.length > 0) {
    sections.push(`Developer: ${game.developers.join(', ')}`);
  }

  if (game.releaseYear !== null) {
    sections.push(`Release year: ${String(game.releaseYear)}`);
  }

  return sections.filter((entry) => entry.trim().length > 0).join('\n\n');
}
