import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExploreContainerComponent } from './explore-container.component';

@NgModule({
    imports: [CommonModule, FormsModule],
    declarations: [ExploreContainerComponent],
    exports: [ExploreContainerComponent]
})
export class ExploreContainerComponentModule { }
