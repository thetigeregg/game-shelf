import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const variablesScss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'variables.scss'),
  'utf8'
);

function getDarkPaletteBlock(): string {
  const match = variablesScss.match(/\.ion-palette-dark\s*\{([\s\S]*?)\n\}/);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('theme variables', () => {
  it('defines dark-palette contrast overrides for bright custom action colors', () => {
    const darkPaletteBlock = getDarkPaletteBlock();

    expect(darkPaletteBlock).toContain('--ion-color-white-contrast: #111111;');
    expect(darkPaletteBlock).toContain('--ion-color-forest-contrast: #111111;');
    expect(darkPaletteBlock).toContain('--ion-color-forest-dark-contrast: #111111;');
    expect(darkPaletteBlock).toContain('--ion-color-mc-good-contrast: #111111;');
    expect(darkPaletteBlock).toContain('--ion-color-mc-okay-contrast: #111111;');
    expect(darkPaletteBlock).toContain('--ion-color-mc-bad-contrast: #111111;');
    expect(darkPaletteBlock).toContain('--ion-color-orange-contrast: #111111;');
    expect(darkPaletteBlock).toContain('--ion-color-firetruck-contrast: #111111;');
  });

  it('keeps rgb companions in sync for dark-palette custom contrast overrides', () => {
    const darkPaletteBlock = getDarkPaletteBlock();

    expect(darkPaletteBlock).toContain('--ion-color-firetruck-contrast-rgb: 17, 17, 17;');
    expect(darkPaletteBlock).toContain('--ion-color-forest-contrast-rgb: 17, 17, 17;');
    expect(darkPaletteBlock).toContain('--ion-color-orange-contrast-rgb: 17, 17, 17;');
  });
});
