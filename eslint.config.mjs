import { defineConfig, globalIgnores } from 'eslint/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import { importX } from 'eslint-plugin-import-x';
import tsParser from '@typescript-eslint/parser';
import unusedImports from 'eslint-plugin-unused-imports';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});
const jsTsFiles = ['**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}'];

export default defineConfig([
  globalIgnores([
    'projects/**/*',
    'coverage/**/*',
    'dist/**/*',
    'www/**/*',
    '.angular/**/*',
    'test-results/**/*'
  ]),

  {
    ...importX.flatConfigs.recommended,
    files: jsTsFiles
  },
  {
    ...importX.flatConfigs.typescript,
    files: jsTsFiles
  },
  {
    files: jsTsFiles,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module'
    }
  },
  {
    files: ['**/*.ts'],

    extends: compat.extends(
      'plugin:@angular-eslint/recommended',
      'plugin:@angular-eslint/template/process-inline-templates'
    ),

    plugins: {
      'import-x': importX,
      'unused-imports': unusedImports
    },

    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',

      parserOptions: {
        project: ['tsconfig.json'],
        createDefaultProgram: true
      }
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
          argsIgnorePattern: '^_'
        }
      ],

      '@angular-eslint/prefer-standalone': 'off',

      '@angular-eslint/component-class-suffix': [
        'error',
        {
          suffixes: ['Page', 'Component']
        }
      ],

      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case'
        }
      ],

      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase'
        }
      ],

      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'Capacitor',
          message:
            'Do not use window.Capacitor directly. Import Capacitor plugins from their @capacitor/* packages.'
        },
        {
          object: 'Capacitor',
          property: 'Plugins',
          message:
            'Do not use Capacitor.Plugins directly. Import Capacitor plugins from their @capacitor/* packages.'
        }
      ]
    }
  },
  {
    files: ['**/*.html'],
    extends: compat.extends('plugin:@angular-eslint/template/recommended'),
    rules: {}
  }
]);
