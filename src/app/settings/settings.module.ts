import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsPageRoutingModule } from './settings-routing.module';
import { SettingsPage } from './settings.page';
import { IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonLabel, IonSelect, IonSelectOption, IonListHeader, IonButton, IonModal, IonIcon, IonFooter, IonSearchbar, IonThumbnail, IonLoading } from "@ionic/angular/standalone";

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        SettingsPageRoutingModule,
        IonHeader,
        IonToolbar,
        IonButtons,
        IonBackButton,
        IonTitle,
        IonContent,
        IonList,
        IonItem,
        IonLabel,
        IonSelect,
        IonSelectOption,
        IonListHeader,
        IonButton,
        IonModal,
        IonIcon,
        IonFooter,
        IonSearchbar,
        IonThumbnail,
        IonLoading
    ],
    declarations: [SettingsPage],
})
export class SettingsPageModule { }
