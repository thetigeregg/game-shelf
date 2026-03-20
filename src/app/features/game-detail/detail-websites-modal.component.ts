import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
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
import { globe, link } from 'ionicons/icons';
import {
  SiAppStoreIcon,
  SiDiscordIcon,
  SiEpicGamesIcon,
  SiGogDotComIcon,
  SiGoogleIcon,
  SiGooglePlayIcon,
  SiItchDotIoIcon,
  SiPlaystationIcon,
  SiRedditIcon,
  SiSteamIcon,
  SiTwitchIcon,
  SiWikipediaIcon,
  SiYoutubeIcon,
} from '@semantic-icons/simple-icons';
import { DetailWebsiteModalIcon, DetailWebsiteModalItem } from './detail-websites-modal.utils';

@Component({
  selector: 'app-detail-websites-modal',
  standalone: true,
  templateUrl: './detail-websites-modal.component.html',
  styles: [
    `
      .website-brand-icon {
        width: 1.375rem;
        height: 1.375rem;
        flex: 0 0 1.375rem;
        display: block;
      }

      .website-brand-icon--forest {
        color: var(--ion-color-forest);
        fill: var(--ion-color-forest);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    SiGoogleIcon,
    SiYoutubeIcon,
    SiTwitchIcon,
    SiDiscordIcon,
    SiRedditIcon,
    SiWikipediaIcon,
    SiEpicGamesIcon,
    SiSteamIcon,
    SiPlaystationIcon,
    SiAppStoreIcon,
    SiGooglePlayIcon,
    SiItchDotIoIcon,
    SiGogDotComIcon,
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
      link,
    });
  }

  isSimpleIcon(icon: DetailWebsiteModalIcon): boolean {
    return icon !== 'ion:globe' && icon !== 'ion:link';
  }
}
