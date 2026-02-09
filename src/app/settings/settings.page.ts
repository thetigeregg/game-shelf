import { Component, inject } from '@angular/core';
import { ThemeService } from '../core/services/theme.service';

interface ThemePreset {
  label: string;
  value: string;
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage {
  readonly presets: ThemePreset[] = [
    { label: 'Ionic Blue', value: '#3880ff' },
    { label: 'Emerald', value: '#2ecc71' },
    { label: 'Sunset Orange', value: '#ff6b35' },
    { label: 'Rose', value: '#e91e63' },
    { label: 'Slate', value: '#546e7a' },
  ];

  selectedColor = '';
  customColor = '';
  private readonly themeService = inject(ThemeService);

  constructor() {
    const currentColor = this.themeService.getPrimaryColor();
    this.selectedColor = this.findPresetColor(currentColor) ?? 'custom';
    this.customColor = currentColor;
  }

  onPresetColorChange(value: string): void {
    if (value === 'custom') {
      this.selectedColor = value;
      this.themeService.setPrimaryColor(this.customColor);
      return;
    }

    this.selectedColor = value;
    this.customColor = value;
    this.themeService.setPrimaryColor(value);
  }

  onCustomColorChange(value: string): void {
    if (!value) {
      return;
    }

    this.customColor = value;
    this.selectedColor = 'custom';
    this.themeService.setPrimaryColor(value);
  }

  private findPresetColor(color: string): string | null {
    return this.presets.find(preset => preset.value === color)?.value ?? null;
  }
}
