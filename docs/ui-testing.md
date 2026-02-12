# UI Testing Suite

This project now uses a two-layer UI testing strategy:

1. Component/UI interaction tests in Vitest.
2. End-to-end smoke tests in Playwright.

## Commands

- `npm run test:ui:component`
  Runs UI-focused component specs (`*.ui.spec.ts`) in JSDOM.

- `npm run test:ui:e2e`
  Runs Playwright smoke tests in Chromium.

- `npm run test:ui`
  Runs both layers (component then e2e).

- `npm run test:ui:e2e:install`
  Installs Playwright Chromium browser binaries.

## Current coverage focus

- Filter menu UI action area and filter-reset behavior.
- Game search UI debounce/result rendering behavior.
- Collection page shell controls and filters menu presence.
- Settings page key navigation sections and actions.

## Enforcement recommendation

Use this minimum gate for PR validation:

1. `npm run lint`
2. `npm run test`
3. `npm run test:ui`
