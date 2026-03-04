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
  globe: {},
  logoGoogle: {},
  logoYoutube: {},
  search: {}
}));

describe('DetailShortcutsFabComponent', () => {
  it('initializes default visibility flags and wires icon registration', () => {
    const component = new DetailShortcutsFabComponent();
    expect(component.showNotesShortcut).toBe(false);
    expect(component.showOpenManualButton).toBe(false);
    expect(component.showFindManualButton).toBe(false);
    expect(addIconsMock).toHaveBeenCalledOnce();
  });

  it('emits shortcut and action events', () => {
    const component = new DetailShortcutsFabComponent();
    const shortcutSpy = vi.fn();
    const notesSpy = vi.fn();
    const closeSpy = vi.fn();
    component.shortcutSearch.subscribe(shortcutSpy);
    component.notesClick.subscribe(notesSpy);
    (component as unknown as { fab?: { close: () => void } }).fab = { close: closeSpy };

    component.onShortcutSearch('google');
    component.onNotesClick();

    expect(shortcutSpy).toHaveBeenCalledWith('google');
    expect(notesSpy).toHaveBeenCalledOnce();
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });
});
