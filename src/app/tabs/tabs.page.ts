import { Component } from '@angular/core';
import { addIcons } from "ionicons";
import { gameController, heart } from "ionicons/icons";

@Component({
    selector: 'app-tabs',
    templateUrl: 'tabs.page.html',
    styleUrls: ['tabs.page.scss'],
    standalone: false,
})
export class TabsPage {

    constructor() {
        addIcons({ gameController, heart });
    }

}
