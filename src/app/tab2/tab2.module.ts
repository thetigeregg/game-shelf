import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Tab2Page } from './tab2.page';
import { GameShelfFeaturesModule } from '../features/game-shelf-features.module';
import { Tab2PageRoutingModule } from './tab2-routing.module';
import { IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonTitle, IonSearchbar, IonContent, IonPopover, IonList, IonItem, IonFab, IonFabButton, IonModal } from "@ionic/angular/standalone";

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        GameShelfFeaturesModule,
        Tab2PageRoutingModule,
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
    declarations: [Tab2Page],
})
export class Tab2PageModule { }
