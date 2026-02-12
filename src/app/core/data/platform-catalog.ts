import { GameCatalogPlatformOption } from '../models/game.models';

export interface PlatformCatalogEntry extends GameCatalogPlatformOption {
  sort_order: number;
}

export const PLATFORM_CATALOG: PlatformCatalogEntry[] = [
  { id: 3, name: 'Linux', sort_order: 1 },
  { id: 4, name: 'Nintendo 64', sort_order: 2 },
  { id: 5, name: 'Wii', sort_order: 3 },
  { id: 6, name: 'PC (Microsoft Windows)', sort_order: 4 },
  { id: 7, name: 'PlayStation', sort_order: 5 },
  { id: 8, name: 'PlayStation 2', sort_order: 6 },
  { id: 9, name: 'PlayStation 3', sort_order: 7 },
  { id: 11, name: 'Xbox', sort_order: 8 },
  { id: 12, name: 'Xbox 360', sort_order: 9 },
  { id: 13, name: 'DOS', sort_order: 10 },
  { id: 14, name: 'Mac', sort_order: 11 },
  { id: 18, name: 'Nintendo Entertainment System', sort_order: 12 },
  { id: 19, name: 'Super Nintendo Entertainment System', sort_order: 13 },
  { id: 20, name: 'Nintendo DS', sort_order: 14 },
  { id: 21, name: 'Nintendo GameCube', sort_order: 15 },
  { id: 22, name: 'Game Boy Color', sort_order: 16 },
  { id: 24, name: 'Game Boy Advance', sort_order: 17 },
  { id: 33, name: 'Game Boy', sort_order: 18 },
  { id: 37, name: 'Nintendo 3DS', sort_order: 19 },
  { id: 38, name: 'PlayStation Portable', sort_order: 20 },
  { id: 41, name: 'Wii U', sort_order: 21 },
  { id: 46, name: 'PlayStation Vita', sort_order: 22 },
  { id: 48, name: 'PlayStation 4', sort_order: 23 },
  { id: 49, name: 'Xbox One', sort_order: 24 },
  { id: 58, name: 'Super Famicom', sort_order: 25 },
  { id: 87, name: 'Virtual Boy', sort_order: 26 },
  { id: 99, name: 'Family Computer', sort_order: 27 },
  { id: 130, name: 'Nintendo Switch', sort_order: 28 },
  { id: 137, name: 'New Nintendo 3DS', sort_order: 29 },
  { id: 159, name: 'Nintendo DSi', sort_order: 30 },
  { id: 167, name: 'PlayStation 5', sort_order: 31 },
  { id: 169, name: 'Xbox Series X|S', sort_order: 32 },
];
