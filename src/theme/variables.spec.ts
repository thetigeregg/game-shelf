import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const variablesScss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'variables.scss'),
  'utf8'
);

function getDarkPaletteBlock(): string {
  const match = variablesScss.match(/\.ion-palette-dark\s*\{([\s\S]*?)\s*\}/);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('theme variables', () => {
  it('defines complete dark-palette token sets for every registered custom color', () => {
    const darkPaletteBlock = getDarkPaletteBlock();

    for (const color of [
      'mc-good',
      'mc-okay',
      'mc-bad',
      'orange',
      'ocean',
      'deep-ocean',
      'dark-gray',
      'firetruck',
      'white',
      'royal',
      'forest',
      'forest-dark',
    ]) {
      expect(darkPaletteBlock).toContain(`--ion-color-${color}:`);
      expect(darkPaletteBlock).toContain(`--ion-color-${color}-rgb:`);
      expect(darkPaletteBlock).toContain(`--ion-color-${color}-contrast:`);
      expect(darkPaletteBlock).toContain(`--ion-color-${color}-contrast-rgb:`);
      expect(darkPaletteBlock).toContain(`--ion-color-${color}-shade:`);
      expect(darkPaletteBlock).toContain(`--ion-color-${color}-tint:`);
    }
  });

  it('keeps filled action custom colors on explicit dark-mode bases with dark contrast', () => {
    const darkPaletteBlock = getDarkPaletteBlock();

    expect(darkPaletteBlock).toMatch(/--ion-color-forest:\s*#69d96b;/);
    expect(darkPaletteBlock).toMatch(/--ion-color-forest-contrast:\s*#111111;/);
    expect(darkPaletteBlock).toMatch(/--ion-color-ocean:\s*#6eb5ff;/);
    expect(darkPaletteBlock).toMatch(/--ion-color-ocean-contrast:\s*#111111;/);
    expect(darkPaletteBlock).toMatch(/--ion-color-deep-ocean:\s*#8b9cff;/);
    expect(darkPaletteBlock).toMatch(/--ion-color-deep-ocean-contrast:\s*#111111;/);
    expect(darkPaletteBlock).toMatch(/--ion-color-royal:\s*#b48cff;/);
    expect(darkPaletteBlock).toMatch(/--ion-color-royal-contrast:\s*#111111;/);
  });
});
