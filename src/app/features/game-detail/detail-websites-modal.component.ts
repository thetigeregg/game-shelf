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
import { globe, library, link, logoXbox } from 'ionicons/icons';
import {
  SiAppStoreIcon,
  SiBlueskyIcon,
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
      .website-item-icon {
        width: 1.375rem;
        height: 1.375rem;
        flex: 0 0 1.375rem;
        display: block;
      }

      ion-icon.website-item-icon {
        font-size: 1.375rem;
      }

      .website-item-icon--forest {
        color: var(--ion-color-forest);
        fill: var(--ion-color-forest);
      }

      .website-item-icon--forest-dark {
        color: var(--ion-color-forest-dark);
        fill: var(--ion-color-forest-dark);
      }

      .website-item-icon--mc-okay {
        color: var(--ion-color-mc-okay);
        fill: var(--ion-color-mc-okay);
      }

      .website-item-icon--ocean {
        color: var(--ion-color-ocean);
        fill: var(--ion-color-ocean);
      }

      .website-item-icon--orange {
        color: var(--ion-color-orange);
        fill: var(--ion-color-orange);
      }

      .website-item-icon--deep-ocean {
        color: var(--ion-color-deep-ocean);
        fill: var(--ion-color-deep-ocean);
      }

      .website-item-icon--mc-bad {
        color: var(--ion-color-mc-bad);
        fill: var(--ion-color-mc-bad);
      }

      .website-item-icon--dark-gray {
        color: var(--ion-color-dark-gray);
        fill: var(--ion-color-dark-gray);
      }

      .website-item-icon--royal {
        color: var(--ion-color-royal);
        fill: var(--ion-color-royal);
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
    SiBlueskyIcon,
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
      library,
      link,
      logoXbox,
    });
  }

  isSimpleIcon(icon: DetailWebsiteModalIcon): boolean {
    return icon !== 'ion:globe' && icon !== 'ion:library' && icon !== 'ion:link';
  }
}
