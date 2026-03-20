import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { IonFab, IonFabButton, IonFabList, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { book, documentText, film, globe } from 'ionicons/icons';

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
        <ion-fab-button
          class="shortcut-websites"
          color="royal"
          aria-label="Open websites"
          (click)="onWebsitesClick()"
        >
          <ion-icon name="globe" aria-hidden="true"></ion-icon>
        </ion-fab-button>
        @if (showVideosShortcut) {
          <ion-fab-button
            class="shortcut-videos"
            color="ocean"
            aria-label="Open game videos"
            (click)="onVideosClick()"
          >
            <ion-icon name="film" aria-hidden="true"></ion-icon>
          </ion-fab-button>
        }
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
    `,
  ],
})
export class DetailShortcutsFabComponent {
  @ViewChild('fab') private fab?: IonFab;

  @Input() showVideosShortcut = false;
  @Input() showNotesShortcut = false;
  @Input() showOpenManualButton = false;

  @Output() listClick = new EventEmitter<void>();
  @Output() websitesClick = new EventEmitter<void>();
  @Output() videosClick = new EventEmitter<void>();
  @Output() notesClick = new EventEmitter<void>();
  @Output() openManualClick = new EventEmitter<void>();

  constructor() {
    addIcons({
      globe,
      film,
      documentText,
      book,
    });
  }

  onListClick(): void {
    this.listClick.emit();
  }

  onVideosClick(): void {
    this.videosClick.emit();
    this.closeFab();
  }

  onNotesClick(): void {
    this.notesClick.emit();
    this.closeFab();
  }

  onOpenManualClick(): void {
    this.openManualClick.emit();
    this.closeFab();
  }

  onWebsitesClick(): void {
    this.websitesClick.emit();
    this.closeFab();
  }

  private closeFab(): void {
    void this.fab?.close();
  }
}
