import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ViewsPageRoutingModule } from './views-routing.module';
import { ViewsPage } from './views.page';
import { IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonIcon, IonPopover, IonFab, IonFabButton, IonModal, IonInput, IonNote } from "@ionic/angular/standalone";

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        ViewsPageRoutingModule,
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
        IonInput,
        IonNote
    ],
    declarations: [ViewsPage],
})
export class ViewsPageModule { }
