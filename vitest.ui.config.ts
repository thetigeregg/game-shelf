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
    include: ['src/app/**/*.ui.spec.ts'],
    server: {
      deps: {
        inline: ['@ionic/angular', '@ionic/angular/standalone', '@ionic/core']
      }
    }
  }
});
