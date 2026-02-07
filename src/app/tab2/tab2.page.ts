import { Component } from '@angular/core';
import { ListType } from '../core/models/game.models';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false,
})
export class Tab2Page {
  readonly listType: ListType = 'wishlist';
}
