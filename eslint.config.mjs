import { defineConfig, globalIgnores } from 'eslint/config';
import { configs as angularConfigs, processInlineTemplates } from 'angular-eslint';
import { importX } from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import { configs as tseslintConfigs } from 'typescript-eslint';

const jsTsFiles = ['**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}'];
const tsFiles = ['**/*.{ts,tsx,mts,cts}'];

// Angular 22's `ng update` pinned these pre-existing components to
// ChangeDetectionStrategy.Eager to preserve their zone-driven behavior. Moving
// them to OnPush is a separate refactor; the rule stays on for everything else,
// so new components can't opt into Eager unnoticed. Remove entries as they move.
const eagerChangeDetectionComponents = [
  'src/app/admin-discovery-match/admin-discovery-match.page.ts',
  'src/app/app.component.ts',
  'src/app/explore/explore.page.ts',
  'src/app/features/game-detail/detail-media-slide.component.ts',
  'src/app/features/game-detail/detail-videos-modal.component.ts',
  'src/app/features/game-detail/emulator-js-modal.component.ts',
  'src/app/features/game-detail/game-detail-content.component.ts',
  'src/app/features/game-detail/similar-game-row.component.ts',
  'src/app/features/game-filters-menu/game-filters-menu.component.ts',
  'src/app/features/game-search/game-search.component.ts',
  'src/app/list-page/list-page.component.ts',
  'src/app/metadata-validator/metadata-validator.page.ts',
  'src/app/settings/ignored-recommendations.page.ts',
  'src/app/settings/settings.page.ts',
  'src/app/tabs/tabs.page.ts',
  'src/app/tags/tags.page.ts',
  'src/app/views/views.page.ts',
];

export default defineConfig([
  globalIgnores([
    'projects/**/*',
    'coverage/**/*',
    'dist/**/*',
    'www/**/*',
    'worktrees/**/*',
    '.angular/**/*',
    'test-results/**/*',
    'ios/DerivedData/**/*',
    'ios/**/native-bridge.js',
    'ios/App/App/public/**/*',
  ]),

  {
    ...importX.flatConfigs.recommended,
    files: jsTsFiles,
  },
  {
    ...importX.flatConfigs.typescript,
    files: jsTsFiles,
  },
  ...tseslintConfigs.strictTypeChecked.map((config) => ({
    ...config,
    files: tsFiles,
  })),
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],

    extends: [...angularConfigs.tsRecommended],
    processor: processInlineTemplates,

    plugins: {
      'import-x': importX,
      'unused-imports': unusedImports,
    },

    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',

      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      '@angular-eslint/prefer-standalone': 'off',

      '@angular-eslint/component-class-suffix': [
        'error',
        {
          suffixes: ['Page', 'Component'],
        },
      ],

      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],

      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],

      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'Capacitor',
          message:
            'Do not use window.Capacitor directly. Import Capacitor plugins from their @capacitor/* packages.',
        },
        {
          object: 'Capacitor',
          property: 'Plugins',
          message:
            'Do not use Capacitor.Plugins directly. Import Capacitor plugins from their @capacitor/* packages.',
        },
      ],
    },
  },
  {
    files: eagerChangeDetectionComponents,
    rules: {
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angularConfigs.templateRecommended],
    rules: {},
  },
]);
