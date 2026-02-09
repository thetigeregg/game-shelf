import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';
import { GameEntry } from '../models/game.models';

@Injectable({ providedIn: 'root' })
export class AppDb extends Dexie {
  games!: Table<GameEntry, number>;

  constructor() {
    super('game-shelf-db');

    this.version(1).stores({
      games: '++id,&externalId,listType,title,createdAt,updatedAt',
    });

    this.version(2).stores({
      games: '++id,&externalId,listType,title,platformIgdbId,createdAt,updatedAt',
    });
  }
}
