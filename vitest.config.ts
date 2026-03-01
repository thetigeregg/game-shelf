import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ionic/core/loader': '@ionic/core/loader/index.js'
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/vitest.setup.ts'],
    include: ['src/**/*.spec.ts'],
    server: {
      deps: {
        inline: ['@ionic/angular', '@ionic/angular/standalone', '@ionic/core']
      }
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/app',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        // Internal diagnostic/logging utility — not testable in isolation
        'src/app/core/services/debug-log.service.ts',
        // Large Angular page/component files covered by E2E (Playwright) tests
        'src/app/features/game-list/game-list.component.ts',
        'src/app/settings/settings.page.ts',
        'src/app/features/game-detail/game-detail-content.component.ts',
        'src/app/features/game-search/game-search.component.ts',
        'src/app/core/directives/auto-content-offsets.directive.ts',
        // Complex browser-API services: public API is unit-tested but the internal
        // async fetch/blob/IndexedDB logic requires extensive browser mocking
        // and is more reliably covered by integration/E2E tests
        'src/app/features/game-search/add-to-library-workflow.service.ts',
        'src/app/core/services/image-cache.service.ts'
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      }
    }
  }
});
