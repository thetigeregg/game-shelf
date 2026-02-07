import { Component } from '@angular/core';
import { ListType } from '../core/models/game.models';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
})
export class Tab1Page {
  readonly listType: ListType = 'collection';
}
