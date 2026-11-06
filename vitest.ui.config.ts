import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/vitest.setup.ts'],
    include: ['src/app/**/*.ui.spec.ts'],
    server: {
      deps: {
        inline: ['@ionic/angular', '@ionic/core'],
      },
    },
  },
});
