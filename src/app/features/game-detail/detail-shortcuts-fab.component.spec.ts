import { describe, expect, it, vi } from 'vitest';
import { DetailShortcutsFabComponent } from './detail-shortcuts-fab.component';

const { addIconsMock } = vi.hoisted(() => ({ addIconsMock: vi.fn() }));

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;
  return {
    IonFab: Stub,
    IonFabButton: Stub,
    IonFabList: Stub,
    IonIcon: Stub,
  };
});

vi.mock('ionicons', () => ({
  addIcons: addIconsMock,
}));

vi.mock('ionicons/icons', () => ({
  book: {},
  documentText: {},
  film: {},
  globe: {},
  link: {},
}));

describe('DetailShortcutsFabComponent', () => {
  it('initializes default visibility flags and wires icon registration', () => {
    const component = new DetailShortcutsFabComponent();
    expect(component.showVideosShortcut).toBe(false);
    expect(component.showNotesShortcut).toBe(false);
    expect(component.showOpenManualButton).toBe(false);
    expect(addIconsMock).toHaveBeenCalledOnce();
  });

  it('emits websites and action events', () => {
    const component = new DetailShortcutsFabComponent();
    const websitesSpy = vi.fn();
    const notesSpy = vi.fn();
    const videosSpy = vi.fn();
    const manualSpy = vi.fn();
    const listSpy = vi.fn();
    const closeSpy = vi.fn();
    component.websitesClick.subscribe(websitesSpy);
    component.notesClick.subscribe(notesSpy);
    component.videosClick.subscribe(videosSpy);
    component.openManualClick.subscribe(manualSpy);
    component.listClick.subscribe(listSpy);
    (component as unknown as { fab?: { close: () => void } }).fab = { close: closeSpy };

    component.onListClick();
    component.onWebsitesClick();
    component.onVideosClick();
    component.onNotesClick();
    component.onOpenManualClick();

    expect(websitesSpy).toHaveBeenCalledOnce();
    expect(videosSpy).toHaveBeenCalledOnce();
    expect(notesSpy).toHaveBeenCalledOnce();
    expect(manualSpy).toHaveBeenCalledOnce();
    expect(listSpy).toHaveBeenCalledOnce();
    expect(closeSpy).toHaveBeenCalledTimes(4);
  });

  it('tolerates action clicks when the fab view child is unavailable', () => {
    const component = new DetailShortcutsFabComponent();

    expect(() => {
      component.onWebsitesClick();
      component.onVideosClick();
      component.onNotesClick();
      component.onOpenManualClick();
    }).not.toThrow();
  });
});
