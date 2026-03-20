import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { globe, search } from 'ionicons/icons';
import { DetailWebsiteModalItem } from './detail-websites-modal.utils';

@Component({
  selector: 'app-detail-websites-modal',
  standalone: true,
  templateUrl: './detail-websites-modal.component.html',
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonIcon,
    IonLabel,
  ],
})
export class DetailWebsitesModalComponent {
  @Input() isOpen = false;
  @Input() items: DetailWebsiteModalItem[] = [];
  @Output() dismiss = new EventEmitter<void>();
  @Output() websiteSelect = new EventEmitter<DetailWebsiteModalItem>();

  constructor() {
    addIcons({
      globe,
      search,
    });
  }
}
