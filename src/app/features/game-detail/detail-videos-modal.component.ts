import { Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCard,
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

interface DetailVideoViewModel {
  key: string;
  title: string;
  watchUrl: string;
  embedUrl: SafeResourceUrl;
}

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
    IonCardTitle
  ]
})
export class DetailVideosModalComponent implements OnChanges {
  private readonly domSanitizer = inject(DomSanitizer);

  @Input() isOpen = false;
  @Input() videos: GameVideo[] | null | undefined;
  @Output() dismiss = new EventEmitter<void>();
  normalizedVideos: DetailVideoViewModel[] = [];

  ngOnChanges(): void {
    this.normalizedVideos = this.buildNormalizedVideos(this.videos);
  }

  private buildNormalizedVideos(videos: GameVideo[] | null | undefined): DetailVideoViewModel[] {
    if (!Array.isArray(videos)) {
      return [];
    }

    const seen = new Set<string>();
    return videos
      .map((video) => {
        const id =
          Number.isInteger(video.id) && (video.id as number) > 0 ? (video.id as number) : null;
        const videoId = typeof video.videoId === 'string' ? video.videoId.trim() : '';
        const name = typeof video.name === 'string' ? video.name.trim() : '';
        const title = name.length > 0 ? name : 'Video';
        const key = id !== null ? `id:${String(id)}` : `video:${videoId}`;
        return {
          key,
          videoId,
          title
        };
      })
      .filter((video) => video.videoId.length > 0 && isValidYouTubeVideoId(video.videoId))
      .filter(
        (video, index, items) =>
          items.findIndex((candidate) => candidate.key === video.key) === index
      )
      .map((video, index) => {
        const dedupeKey = `video:${video.videoId}`;
        if (seen.has(dedupeKey)) {
          return null;
        }

        seen.add(dedupeKey);
        const title = video.title === 'Video' ? `Video ${String(index + 1)}` : video.title;
        const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
        const embedUrl = this.domSanitizer.bypassSecurityTrustResourceUrl(
          `https://www.youtube.com/embed/${video.videoId}`
        );
        return {
          key: video.key,
          title,
          watchUrl,
          embedUrl
        } satisfies DetailVideoViewModel;
      })
      .filter((video): video is DetailVideoViewModel => video !== null);
  }
}

function isValidYouTubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}
