import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;
  return {
    IonModal: Stub,
    IonHeader: Stub,
    IonToolbar: Stub,
    IonTitle: Stub,
    IonButtons: Stub,
    IonButton: Stub,
    IonContent: Stub,
    IonCard: Stub,
    IonCardHeader: Stub,
    IonCardTitle: Stub
  };
});

import { DetailVideosModalComponent } from './detail-videos-modal.component';

describe('DetailVideosModalComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DomSanitizer,
          useValue: {
            bypassSecurityTrustResourceUrl: vi.fn((value: string) => `safe:${value}`)
          }
        }
      ]
    });
  });

  function createComponent(): DetailVideosModalComponent {
    return TestBed.runInInjectionContext(() => new DetailVideosModalComponent());
  }

  it('normalizes and keeps only valid youtube video ids', () => {
    const component = createComponent();
    component.videos = [
      {
        id: 1,
        name: 'Trailer',
        videoId: 'PIF_fqFZEuk',
        url: 'https://www.youtube.com/watch?v=PIF_fqFZEuk'
      },
      { id: 2, name: 'Bad', videoId: 'invalid', url: 'https://example.com' }
    ];

    component.ngOnChanges();

    expect(component.normalizedVideos).toHaveLength(1);
    expect(component.normalizedVideos[0]?.title).toBe('Trailer');
    expect(component.normalizedVideos[0]?.watchUrl).toBe(
      'https://www.youtube.com/watch?v=PIF_fqFZEuk'
    );
    expect(component.normalizedVideos[0]?.embedUrl).toBe(
      'safe:https://www.youtube.com/embed/PIF_fqFZEuk'
    );
  });

  it('falls back to numbered title and dedupes by video id', () => {
    const component = createComponent();
    component.videos = [
      { id: 10, name: null, videoId: 'PIF_fqFZEuk', url: '' },
      { id: 11, name: 'Duplicate', videoId: 'PIF_fqFZEuk', url: '' }
    ];

    component.ngOnChanges();

    expect(component.normalizedVideos).toHaveLength(1);
    expect(component.normalizedVideos[0]?.title).toBe('Video 1');
  });
});
