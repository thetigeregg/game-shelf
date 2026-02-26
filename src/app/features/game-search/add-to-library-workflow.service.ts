import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';
import { GameCatalogResult, GameEntry, ListType } from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';
import { PlatformOrderService } from '../../core/services/platform-order.service';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';

interface SelectedPlatform {
  id: number;
  name: string;
}

export interface AddToLibraryResult {
  status: 'added' | 'cancelled' | 'duplicate' | 'invalid-platform';
  entry?: GameEntry;
}

@Injectable({ providedIn: 'root' })
export class AddToLibraryWorkflowService {
  private readonly gameShelfService = inject(GameShelfService);
  private readonly platformOrderService = inject(PlatformOrderService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);

  async addToLibrary(result: GameCatalogResult, listType: ListType): Promise<AddToLibraryResult> {
    const platformSelection = await this.resolvePlatformSelection(result);

    if (platformSelection === undefined) {
      return { status: 'cancelled' };
    }

    const existingEntry = await this.gameShelfService.findGameByIdentity(
      result.igdbGameId,
      platformSelection.id
    );

    if (existingEntry) {
      await this.presentDuplicateAlert(
        result.title,
        this.getPlatformDisplayName(platformSelection.name, platformSelection.id)
      );
      return { status: 'duplicate' };
    }

    const resolvedForAdd = await this.resolveCoverForAdd(result, platformSelection);
    const resolvedCatalog: GameCatalogResult = {
      ...resolvedForAdd,
      igdbGameId: result.igdbGameId,
      platform: platformSelection.name,
      platformIgdbId: platformSelection.id
    };

    const entry = await this.gameShelfService.addGame(resolvedCatalog, listType);
    await this.presentToast(`Added to ${listType === 'collection' ? 'Collection' : 'Wishlist'}.`);
    return { status: 'added', entry };
  }

  private getPlatformDisplayName(
    name: string | null | undefined,
    platformIgdbId: number | null | undefined
  ): string {
    const label = this.platformCustomizationService
      .getDisplayNameWithoutAlias(name, platformIgdbId)
      .trim();
    return label.length > 0 ? label : 'Unknown platform';
  }

  private async resolvePlatformSelection(
    result: GameCatalogResult
  ): Promise<SelectedPlatform | undefined> {
    const platforms = this.getPlatformOptions(result);

    if (platforms.length === 0) {
      await this.presentPlatformRequiredAlert(result.title);
      return undefined;
    }

    if (platforms.length === 1) {
      return platforms[0];
    }

    let selectedIndex = 0;
    const alert = await this.alertController.create({
      header: 'Choose platform',
      message: `Select a platform for ${result.title}.`,
      inputs: platforms.map((platform, index) => ({
        type: 'radio',
        label: this.getPlatformDisplayName(platform.name, platform.id),
        value: String(index),
        checked: index === selectedIndex
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          role: 'confirm',
          handler: (value: string) => {
            const parsed = Number.parseInt(value, 10);

            if (Number.isInteger(parsed) && parsed >= 0 && parsed < platforms.length) {
              selectedIndex = parsed;
            }
          }
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return undefined;
    }

    return platforms[selectedIndex];
  }

  private getPlatformOptions(result: GameCatalogResult): SelectedPlatform[] {
    if (Array.isArray(result.platformOptions) && result.platformOptions.length > 0) {
      return result.platformOptions
        .map((option) => {
          const name = typeof option.name === 'string' ? option.name.trim() : '';
          const id =
            typeof option.id === 'number' && Number.isInteger(option.id) && option.id > 0
              ? option.id
              : null;
          return { id, name };
        })
        .filter((option) => option.name.length > 0 && option.id !== null)
        .filter((option, index, items) => {
          return (
            items.findIndex(
              (candidate) => candidate.id === option.id && candidate.name === option.name
            ) === index
          );
        })
        .map((option) => ({
          id: option.id as number,
          name: option.name
        }))
        .sort((left, right) =>
          this.platformOrderService.comparePlatformNames(left.name, right.name)
        );
    }

    return [];
  }

  private async resolveCoverForAdd(
    result: GameCatalogResult,
    platform: SelectedPlatform
  ): Promise<GameCatalogResult> {
    try {
      const useIgdbCover = this.gameShelfService.shouldUseIgdbCoverForPlatform(
        platform.name,
        platform.id
      );
      const candidates = await firstValueFrom(
        this.gameShelfService.searchBoxArtByTitle(
          result.title,
          platform.name,
          platform.id,
          result.igdbGameId
        )
      );
      const boxArtUrl = candidates[0];

      if (!boxArtUrl) {
        return result;
      }

      return {
        ...result,
        coverUrl: boxArtUrl,
        coverSource: useIgdbCover ? 'igdb' : 'thegamesdb'
      };
    } catch {
      return result;
    }
  }

  private async presentToast(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color: 'primary'
    });

    await toast.present();
  }

  private async presentDuplicateAlert(title: string, platformName: string): Promise<void> {
    const platformSuffix = platformName ? ` on ${platformName}` : '';
    const alert = await this.alertController.create({
      header: 'Duplicate Game',
      message: `${title}${platformSuffix} is already in your game shelf.`,
      buttons: ['OK']
    });

    await alert.present();
  }

  private async presentPlatformRequiredAlert(title: string): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Platform Required',
      message: `A valid IGDB platform is required to add ${title}.`,
      buttons: ['OK']
    });

    await alert.present();
  }
}
