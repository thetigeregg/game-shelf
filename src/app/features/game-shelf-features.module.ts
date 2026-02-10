import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameListComponent } from './game-list/game-list.component';
import { GameSearchComponent } from './game-search/game-search.component';
import { GameFiltersMenuComponent } from './game-filters-menu/game-filters-menu.component';
import { IonMenu, IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuToggle, IonButton, IonContent, IonList, IonItem, IonSelect, IonSelectOption, IonLabel, IonDatetimeButton, IonModal, IonDatetime, IonAccordionGroup, IonAccordion, IonItemSliding, IonIcon, IonBadge, IonItemOptions, IonItemOption, IonPopover, IonSearchbar, IonSpinner, IonGrid, IonRow, IonCol, IonText, IonRange, IonNote } from "@ionic/angular/standalone";

@NgModule({
    declarations: [GameListComponent, GameSearchComponent, GameFiltersMenuComponent],
    imports: [CommonModule, FormsModule, IonMenu, IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuToggle, IonButton, IonContent, IonList, IonItem, IonSelect, IonSelectOption, IonLabel, IonDatetimeButton, IonModal, IonDatetime, IonList, IonItem, IonLabel, IonAccordionGroup, IonAccordion, IonItemSliding, IonIcon, IonBadge, IonItemOptions, IonItemOption, IonPopover, IonContent, IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonSelect, IonSelectOption, IonSearchbar, IonSpinner, IonGrid, IonRow, IonCol, IonText, IonRange, IonNote, IonItem, IonSelect, IonSelectOption, IonLabel, IonSearchbar, IonList, IonSpinner, IonBadge, IonButton],
    exports: [GameListComponent, GameSearchComponent, GameFiltersMenuComponent],
})
export class GameShelfFeaturesModule { }
