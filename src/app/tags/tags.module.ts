import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TagsPageRoutingModule } from './tags-routing.module';
import { TagsPage } from './tags.page';
import { IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonIcon, IonPopover, IonFab, IonFabButton, IonModal, IonInput } from "@ionic/angular/standalone";

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        TagsPageRoutingModule,
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
        IonFab,
        IonFabButton,
        IonModal,
        IonInput
    ],
    declarations: [TagsPage],
})
export class TagsPageModule { }
