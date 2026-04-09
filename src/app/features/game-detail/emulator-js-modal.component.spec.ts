import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

vi.mock('@ionic/angular/standalone', () => {
  const Stub = () => null;
  return {
    IonModal: Stub,
    IonContent: Stub,
  };
});

import { EmulatorJsModalComponent } from './emulator-js-modal.component';

describe('EmulatorJsModalComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DomSanitizer,
          useValue: {
            bypassSecurityTrustResourceUrl: vi.fn((value: string) => `safe:${value}`),
          },
        },
      ],
    });
  });

  function createComponent(): EmulatorJsModalComponent {
    return TestBed.runInInjectionContext(() => new EmulatorJsModalComponent());
  }

  it('sanitizes launch URL on changes and clears empty values', () => {
    const component = createComponent();

    component.launchUrl = '  https://app.test/assets/emulatorjs/play.html?core=nes  ';
    component.ngOnChanges();
    expect(component.safeLaunchUrl).toBe(
      'safe:https://app.test/assets/emulatorjs/play.html?core=nes'
    );

    component.launchUrl = '   ';
    component.ngOnChanges();
    expect(component.safeLaunchUrl).toBeNull();
  });

  it('emits dismiss only for same-origin emulator exit messages while open', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.dismiss, 'emit');
    component.isOpen = true;

    component.onWindowMessage({
      origin: window.location.origin,
      data: { source: 'game-shelf-emulatorjs', type: 'emulator-exit' },
    } as MessageEvent<unknown>);

    expect(emitSpy).toHaveBeenCalledOnce();
  });

  it('ignores messages when closed, foreign-origin, or invalid payload', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.dismiss, 'emit');

    component.isOpen = false;
    component.onWindowMessage({
      origin: window.location.origin,
      data: { source: 'game-shelf-emulatorjs', type: 'emulator-exit' },
    } as MessageEvent<unknown>);

    component.isOpen = true;
    component.onWindowMessage({
      origin: 'https://evil.test',
      data: { source: 'game-shelf-emulatorjs', type: 'emulator-exit' },
    } as MessageEvent<unknown>);

    component.onWindowMessage({
      origin: window.location.origin,
      data: { source: 'other', type: 'emulator-exit' },
    } as MessageEvent<unknown>);

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('emits dismiss when modal close handler runs', () => {
    const component = createComponent();
    const emitSpy = vi.spyOn(component.dismiss, 'emit');

    component.onClose();

    expect(emitSpy).toHaveBeenCalledOnce();
  });
});
