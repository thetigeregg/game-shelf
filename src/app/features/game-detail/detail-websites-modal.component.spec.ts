import { describe, expect, it, vi } from 'vitest';
import { DetailWebsitesModalComponent } from './detail-websites-modal.component';

const { addIconsMock } = vi.hoisted(() => ({ addIconsMock: vi.fn() }));

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
    IonList: Stub,
    IonItem: Stub,
    IonIcon: Stub,
    IonLabel: Stub,
  };
});

vi.mock('ionicons', () => ({
  addIcons: addIconsMock,
}));

vi.mock('ionicons/icons', () => ({
  globe: {},
  library: {},
  link: {},
  logoXbox: {},
}));

vi.mock('@semantic-icons/simple-icons', () => {
  const Stub = () => null;
  return {
    SiGoogleIcon: Stub,
    SiYoutubeIcon: Stub,
    SiTwitchIcon: Stub,
    SiDiscordIcon: Stub,
    SiRedditIcon: Stub,
    SiWikipediaIcon: Stub,
    SiEpicGamesIcon: Stub,
    SiSteamIcon: Stub,
    SiPlaystationIcon: Stub,
    SiAppStoreIcon: Stub,
    SiGooglePlayIcon: Stub,
    SiItchDotIoIcon: Stub,
    SiGogDotComIcon: Stub,
  };
});

describe('DetailWebsitesModalComponent', () => {
  it('initializes closed with an empty list and ionicon registration', () => {
    const component = new DetailWebsitesModalComponent();

    expect(component.isOpen).toBe(false);
    expect(component.items).toEqual([]);
    expect(addIconsMock).toHaveBeenCalledOnce();
  });

  it('emits dismiss and select events', () => {
    const component = new DetailWebsitesModalComponent();
    const dismissSpy = vi.fn();
    const selectSpy = vi.fn();
    const item = {
      key: 'item:wikipedia',
      label: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Test',
      icon: 'wikipedia' as const,
    };

    component.dismiss.subscribe(dismissSpy);
    component.websiteSelect.subscribe(selectSpy);

    component.dismiss.emit();
    component.websiteSelect.emit(item);

    expect(dismissSpy).toHaveBeenCalledOnce();
    expect(selectSpy).toHaveBeenCalledWith(item);
  });

  it('recognizes simple icons separately from ionicons', () => {
    const component = new DetailWebsitesModalComponent();

    expect(component.isSimpleIcon('google')).toBe(true);
    expect(component.isSimpleIcon('ion:globe')).toBe(false);
    expect(component.isSimpleIcon('ion:library')).toBe(false);
    expect(component.isSimpleIcon('ion:link')).toBe(false);
  });
});
