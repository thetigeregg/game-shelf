import { describe, expect, it, vi } from 'vitest';
import { DetailShortcutsFabComponent } from './detail-shortcuts-fab.component';

const { addIconsMock } = vi.hoisted(() => ({ addIconsMock: vi.fn() }));

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;
  return {
    IonFab: Stub,
    IonFabButton: Stub,
    IonFabList: Stub,
    IonIcon: Stub
  };
});

vi.mock('ionicons', () => ({
  addIcons: addIconsMock
}));

vi.mock('ionicons/icons', () => ({
  book: {},
  documentText: {},
  film: {},
  globe: {},
  logoGoogle: {},
  logoYoutube: {}
}));

describe('DetailShortcutsFabComponent', () => {
  it('initializes default visibility flags and wires icon registration', () => {
    const component = new DetailShortcutsFabComponent();
    expect(component.showVideosShortcut).toBe(false);
    expect(component.showNotesShortcut).toBe(false);
    expect(component.showOpenManualButton).toBe(false);
    expect(addIconsMock).toHaveBeenCalledOnce();
  });

  it('emits shortcut and action events', () => {
    const component = new DetailShortcutsFabComponent();
    const shortcutSpy = vi.fn();
    const notesSpy = vi.fn();
    const videosSpy = vi.fn();
    const manualSpy = vi.fn();
    const listSpy = vi.fn();
    const closeSpy = vi.fn();
    component.shortcutSearch.subscribe(shortcutSpy);
    component.notesClick.subscribe(notesSpy);
    component.videosClick.subscribe(videosSpy);
    component.openManualClick.subscribe(manualSpy);
    component.listClick.subscribe(listSpy);
    (component as unknown as { fab?: { close: () => void } }).fab = { close: closeSpy };

    component.onListClick();
    component.onShortcutSearch('google');
    component.onVideosClick();
    component.onNotesClick();
    component.onOpenManualClick();

    expect(shortcutSpy).toHaveBeenCalledWith('google');
    expect(videosSpy).toHaveBeenCalledOnce();
    expect(notesSpy).toHaveBeenCalledOnce();
    expect(manualSpy).toHaveBeenCalledOnce();
    expect(listSpy).toHaveBeenCalledOnce();
    expect(closeSpy).toHaveBeenCalledTimes(4);
  });
});
