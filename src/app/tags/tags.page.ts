import { Component, OnInit, inject } from '@angular/core';
import { AlertController, PopoverController, ToastController } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonIcon, IonPopover, IonModal, IonInput } from "@ionic/angular/standalone";
import { Observable } from 'rxjs';
import { GameShelfService } from '../core/services/game-shelf.service';
import { TagSummary } from '../core/models/game.models';
import { addIcons } from "ionicons";
import { ellipsisVertical, add } from "ionicons/icons";

@Component({
    selector: 'app-tags',
    templateUrl: './tags.page.html',
    styleUrls: ['./tags.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        IonHeader,
        IonToolbar,
        IonButtons,
        IonBackButton,
        IonTitle,
        IonContent,
        IonList,
        IonItem,
        IonLabel,
        IonButton,
        IonIcon,
        IonPopover,
        IonModal,
        IonInput,
    ],
})
export class TagsPage implements OnInit {
    tags$!: Observable<TagSummary[]>;
    isTagModalOpen = false;
    editingTagId: number | null = null;
    draftName = '';
    draftColor = '#3880ff';

    private readonly gameShelfService = inject(GameShelfService);
    private readonly popoverController = inject(PopoverController);
    private readonly alertController = inject(AlertController);
    private readonly toastController = inject(ToastController);

    ngOnInit(): void {
        this.tags$ = this.gameShelfService.watchTags();
    }

    openNewTagModal(): void {
        this.editingTagId = null;
        this.draftName = '';
        this.draftColor = '#3880ff';
        this.isTagModalOpen = true;
    }

    closeTagModal(): void {
        this.isTagModalOpen = false;
    }

    async openEditTagFromPopover(tag: TagSummary): Promise<void> {
        await this.popoverController.dismiss();
        this.openEditTagModal(tag);
    }

    openEditTagModal(tag: TagSummary): void {
        this.editingTagId = typeof tag.id === 'number' ? tag.id : null;
        this.draftName = tag.name;
        this.draftColor = tag.color;
        this.isTagModalOpen = true;
    }

    async deleteTagFromPopover(tag: TagSummary): Promise<void> {
        await this.popoverController.dismiss();

        if (typeof tag.id !== 'number') {
            return;
        }

        const confirm = await this.alertController.create({
            header: 'Delete Tag',
            message: `Delete tag \"${tag.name}\"?`,
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: 'Delete',
                    role: 'confirm',
                    cssClass: 'alert-button-danger',
                },
            ],
        });

        await confirm.present();
        const { role } = await confirm.onDidDismiss();

        if (role !== 'confirm') {
            return;
        }

        await this.gameShelfService.deleteTag(tag.id);
        await this.presentToast('Tag deleted.');
    }

    async saveTag(): Promise<void> {
        const normalizedName = this.draftName.trim();

        if (normalizedName.length === 0) {
            await this.presentToast('Tag name is required.', 'warning');
            return;
        }

        if (this.editingTagId === null) {
            await this.gameShelfService.createTag(normalizedName, this.draftColor);
            await this.presentToast('Tag created.');
        } else {
            await this.gameShelfService.updateTag(this.editingTagId, normalizedName, this.draftColor);
            await this.presentToast('Tag updated.');
        }

        this.closeTagModal();
    }

    getActionsTriggerId(tag: TagSummary): string {
        return `tag-actions-trigger-${tag.id ?? tag.name}`;
    }

    getTagTextColor(color: string): string {
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
            return '#ffffff';
        }

        const red = Number.parseInt(color.slice(1, 3), 16);
        const green = Number.parseInt(color.slice(3, 5), 16);
        const blue = Number.parseInt(color.slice(5, 7), 16);
        const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

        return luminance > 0.6 ? '#000000' : '#ffffff';
    }

    trackByTagId(_: number, tag: TagSummary): string {
        return String(tag.id ?? tag.name);
    }

    private async presentToast(message: string, color: 'primary' | 'warning' = 'primary'): Promise<void> {
        const toast = await this.toastController.create({
            message,
            duration: 1500,
            position: 'bottom',
            color,
        });

        await toast.present();
    }

    constructor() {
        addIcons({ ellipsisVertical, add });
    }
}
