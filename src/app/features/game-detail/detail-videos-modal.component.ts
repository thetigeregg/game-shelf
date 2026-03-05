import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonModal,
  IonTitle,
  IonToolbar
} from '@ionic/angular/standalone';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { GameVideo } from '../../core/models/game.models';

@Component({
  selector: 'app-detail-videos-modal',
  standalone: true,
  templateUrl: './detail-videos-modal.component.html',
  styleUrls: ['./detail-videos-modal.component.scss'],
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent
  ]
})
export class DetailVideosModalComponent {
  private readonly domSanitizer = inject(DomSanitizer);

  @Input() isOpen = false;
  @Input() videos: GameVideo[] | null | undefined;
  @Output() dismiss = new EventEmitter<void>();

  get normalizedVideos(): GameVideo[] {
    if (!Array.isArray(this.videos)) {
      return [];
    }

    return this.videos
      .map((video) => {
        const id =
          Number.isInteger(video.id) && (video.id as number) > 0 ? (video.id as number) : null;
        const videoId = typeof video.videoId === 'string' ? video.videoId.trim() : '';
        const name = typeof video.name === 'string' ? video.name.trim() : '';
        const url = typeof video.url === 'string' ? video.url.trim() : '';
        return {
          id,
          videoId,
          name: name.length > 0 ? name : null,
          url
        };
      })
      .filter((video) => video.videoId.length > 0 && video.url.length > 0);
  }

  getVideoTitle(video: GameVideo, index: number): string {
    const name = typeof video.name === 'string' ? video.name.trim() : '';
    return name.length > 0 ? name : `Video ${String(index + 1)}`;
  }

  isDirectPlayableVideoUrl(url: string | null | undefined): boolean {
    const normalized = typeof url === 'string' ? url.trim().toLowerCase() : '';
    return (
      normalized.endsWith('.mp4') ||
      normalized.endsWith('.webm') ||
      normalized.endsWith('.ogg') ||
      normalized.endsWith('.m4v') ||
      normalized.endsWith('.mov')
    );
  }

  getEmbedUrl(video: GameVideo): SafeResourceUrl | null {
    const raw = this.toYoutubeEmbedUrl(video.url);
    return raw ? this.domSanitizer.bypassSecurityTrustResourceUrl(raw) : null;
  }

  openVideoUrl(url: string | null | undefined): void {
    const normalized = typeof url === 'string' ? url.trim() : '';
    if (!normalized) {
      return;
    }

    if (typeof window !== 'undefined') {
      window.open(normalized, '_blank', 'noopener');
    }
  }

  private toYoutubeEmbedUrl(url: string | null | undefined): string | null {
    const normalized = typeof url === 'string' ? url.trim() : '';
    if (!normalized) {
      return null;
    }

    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname.toLowerCase();

      if (host.includes('youtube.com')) {
        const videoId = parsed.searchParams.get('v')?.trim() ?? '';
        return videoId.length > 0 ? `https://www.youtube.com/embed/${videoId}` : null;
      }

      if (host === 'youtu.be') {
        const videoId = parsed.pathname.replace('/', '').trim();
        return videoId.length > 0 ? `https://www.youtube.com/embed/${videoId}` : null;
      }
    } catch {
      return null;
    }

    return null;
  }
}
