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
      reporter: ['text', 'html'],
      thresholds: {
        statements: 80,
        branches: 73,
        functions: 84,
        lines: 80
      }
    }
  }
});
