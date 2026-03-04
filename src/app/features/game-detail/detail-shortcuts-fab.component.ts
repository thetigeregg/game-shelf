import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { IonFab, IonFabButton, IonFabList, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { book, documentText, globe, logoGoogle, logoYoutube, search } from 'ionicons/icons';

type ShortcutProvider = 'google' | 'youtube' | 'wikipedia' | 'gamefaqs';

@Component({
  selector: 'app-detail-shortcuts-fab',
  standalone: true,
  imports: [IonFab, IonFabButton, IonFabList, IonIcon],
  template: `
    <ion-fab #fab vertical="bottom" horizontal="end" class="detail-shortcuts-fab">
      <ion-fab-button size="small" aria-label="Open web shortcuts">
        <ion-icon name="globe" aria-hidden="true"></ion-icon>
      </ion-fab-button>
      <ion-fab-list side="top" (click)="onListClick()">
        @if (showNotesShortcut) {
          <ion-fab-button
            class="shortcut-notes"
            color="deep-ocean"
            aria-label="Open notes editor"
            (click)="onNotesClick()"
          >
            <ion-icon name="document-text" aria-hidden="true"></ion-icon>
          </ion-fab-button>
        }
        @if (showOpenManualButton) {
          <ion-fab-button
            class="shortcut-manual"
            color="ocean"
            aria-label="Open game manual PDF"
            (click)="onOpenManualClick()"
          >
            <ion-icon name="book" aria-hidden="true"></ion-icon>
          </ion-fab-button>
        }
        @if (showFindManualButton) {
          <ion-fab-button
            class="shortcut-manual-find"
            color="dark-gray"
            aria-label="Find game manual PDF"
            (click)="onFindManualClick()"
          >
            <ion-icon name="search" aria-hidden="true"></ion-icon>
          </ion-fab-button>
        }
        <ion-fab-button
          class="shortcut-google"
          color="forest"
          aria-label="Search on Google"
          (click)="onShortcutSearch('google')"
        >
          <ion-icon name="logo-google" aria-hidden="true"></ion-icon>
        </ion-fab-button>
        <ion-fab-button
          class="shortcut-youtube"
          color="firetruck"
          aria-label="Search on YouTube"
          (click)="onShortcutSearch('youtube')"
        >
          <ion-icon name="logo-youtube" aria-hidden="true"></ion-icon>
        </ion-fab-button>
        <ion-fab-button
          class="shortcut-wikipedia"
          color="white"
          aria-label="Search on Wikipedia"
          (click)="onShortcutSearch('wikipedia')"
        >
          <span class="shortcut-text" aria-hidden="true">W</span>
        </ion-fab-button>
        <ion-fab-button
          class="shortcut-gamefaqs"
          color="royal"
          aria-label="Search on GameFAQs"
          (click)="onShortcutSearch('gamefaqs')"
        >
          <span class="shortcut-text" aria-hidden="true">G</span>
        </ion-fab-button>
      </ion-fab-list>
    </ion-fab>
  `,
  styles: [
    `
      :host {
        position: fixed;
        right: max(8px, env(safe-area-inset-right));
        bottom: max(8px, env(safe-area-inset-bottom));
        z-index: 20;
      }

      .detail-shortcuts-fab {
        margin: 0;
      }

      .detail-shortcuts-fab .shortcut-text {
        font-size: 0.9rem;
        font-weight: 700;
        line-height: 1;
      }
    `
  ]
})
export class DetailShortcutsFabComponent {
  @ViewChild('fab') private fab?: IonFab;

  @Input() showNotesShortcut = false;
  @Input() showOpenManualButton = false;
  @Input() showFindManualButton = false;

  @Output() listClick = new EventEmitter<void>();
  @Output() notesClick = new EventEmitter<void>();
  @Output() openManualClick = new EventEmitter<void>();
  @Output() findManualClick = new EventEmitter<void>();
  @Output() shortcutSearch = new EventEmitter<ShortcutProvider>();

  constructor() {
    addIcons({
      globe,
      documentText,
      book,
      search,
      logoGoogle,
      logoYoutube
    });
  }

  onListClick(): void {
    this.listClick.emit();
  }

  onNotesClick(): void {
    this.notesClick.emit();
    this.closeFab();
  }

  onOpenManualClick(): void {
    this.openManualClick.emit();
    this.closeFab();
  }

  onFindManualClick(): void {
    this.findManualClick.emit();
    this.closeFab();
  }

  onShortcutSearch(provider: ShortcutProvider): void {
    this.shortcutSearch.emit(provider);
    this.closeFab();
  }

  private closeFab(): void {
    void this.fab?.close();
  }
}
