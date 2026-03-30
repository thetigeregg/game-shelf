import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular/standalone', () => {
  const Dummy = () => null;
  const AlertControllerToken = function AlertController() {
    return undefined;
  };
  const PopoverControllerToken = function PopoverController() {
    return undefined;
  };
  const ToastControllerToken = function ToastController() {
    return undefined;
  };

  return {
    AlertController: AlertControllerToken,
    PopoverController: PopoverControllerToken,
    ToastController: ToastControllerToken,
    IonHeader: Dummy,
    IonToolbar: Dummy,
    IonButtons: Dummy,
    IonBackButton: Dummy,
    IonTitle: Dummy,
    IonContent: Dummy,
    IonList: Dummy,
    IonItem: Dummy,
    IonLabel: Dummy,
    IonButton: Dummy,
    IonIcon: Dummy,
    IonFab: Dummy,
    IonFabButton: Dummy,
    IonPopover: Dummy,
    IonModal: Dummy,
    IonInput: Dummy,
    IonNote: Dummy,
  };
});

import { AlertController, PopoverController, ToastController } from '@ionic/angular/standalone';
import { GameShelfService } from '../core/services/game-shelf.service';
import { GLOBAL_CREATE_FAB_COLOR } from '../core/theme/filled-action-surface-colors';
import { ViewsPage } from './views.page';

describe('ViewsPage', () => {
  const gameShelfServiceMock = {
    watchViews: vi.fn(() => of([])),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GameShelfService, useValue: gameShelfServiceMock },
        { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
        { provide: PopoverController, useValue: { dismiss: vi.fn().mockResolvedValue(undefined) } },
        { provide: AlertController, useValue: { create: vi.fn() } },
        { provide: ToastController, useValue: { create: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the shared create fab color contract', () => {
    const page = TestBed.runInInjectionContext(() => new ViewsPage());

    expect(page.createFabColor).toBe(GLOBAL_CREATE_FAB_COLOR);
  });
});
