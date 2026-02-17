import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ionic/core/loader': '@ionic/core/loader/index.js',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/vitest.setup.ts'],
    include: ['src/**/*.spec.ts'],
    server: {
      deps: {
        inline: ['@ionic/angular', '@ionic/angular/standalone', '@ionic/core'],
      },
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/app',
      reporter: ['text', 'html'],
      exclude: [
        'src/app/core/services/debug-log.service.ts',
        'src/app/core/services/image-cache.service.ts',
        'src/app/core/services/game-shelf.service.ts',
        'src/app/core/api/igdb-proxy.service.ts',
        'src/app/metadata-validator/metadata-validator.page.ts',
        'src/app/settings/settings.page.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 90,
        lines: 90,
      },
    },
  },
});
