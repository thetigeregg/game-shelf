export type ListType = 'collection' | 'wishlist';

export interface GameCatalogResult {
  externalId: string;
  title: string;
  coverUrl: string | null;
  platform: string | null;
  releaseYear: number | null;
}

export interface GameEntry {
  id?: number;
  externalId: string;
  title: string;
  coverUrl: string | null;
  platform: string | null;
  releaseYear: number | null;
  listType: ListType;
  createdAt: string;
  updatedAt: string;
}
