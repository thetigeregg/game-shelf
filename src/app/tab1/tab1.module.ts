import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Tab1Page } from './tab1.page';
import { GameShelfFeaturesModule } from '../features/game-shelf-features.module';
import { Tab1PageRoutingModule } from './tab1-routing.module';
import { IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonTitle, IonSearchbar, IonContent, IonPopover, IonList, IonItem, IonFab, IonFabButton, IonModal } from "@ionic/angular/standalone";

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        GameShelfFeaturesModule,
        Tab1PageRoutingModule,
        IonHeader,
        IonToolbar,
        IonButtons,
        IonButton,
        IonIcon,
        IonTitle,
        IonSearchbar,
        IonContent,
        IonPopover,
        IonList,
        IonItem,
        IonFab,
        IonFabButton,
        IonModal
    ],
    declarations: [Tab1Page],
})
export class Tab1PageModule { }
