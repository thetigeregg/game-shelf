import { Component, inject } from '@angular/core';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  private readonly themeService = inject(ThemeService);

  constructor() {
    this.themeService.initialize();
  }
}
