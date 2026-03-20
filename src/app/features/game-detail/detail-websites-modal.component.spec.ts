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
  search: {},
}));

describe('DetailWebsitesModalComponent', () => {
  it('initializes closed and registers placeholder icons', () => {
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
      icon: 'globe',
    };

    component.dismiss.subscribe(dismissSpy);
    component.websiteSelect.subscribe(selectSpy);

    component.dismiss.emit();
    component.websiteSelect.emit(item);

    expect(dismissSpy).toHaveBeenCalledOnce();
    expect(selectSpy).toHaveBeenCalledWith(item);
  });
});
