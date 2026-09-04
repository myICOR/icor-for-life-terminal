/* The community directory's scanner, run in-repo. The rules it applies are
 * published as eslint-plugin-obsidianmd, so `npm run lint` is the same
 * instrument the directory uses, and a finding fails the gate here before it
 * fails a listing in public. The stylesheet is in scope too, because the
 * scanner reads it. */
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import css from '@eslint/css';

export default defineConfig([
  ...obsidianmd.configs.recommended.map((c) => ({
    files: ['**/*.ts', '**/*.mjs'],
    ...c,
  })),
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.*'],
        },
      },
    },
    plugins: { obsidianmd },
    rules: {
      'obsidianmd/ui/sentence-case': ['warn', {
        brands: ['Claude Code', 'Claude', 'ICOR', 'Obsidian', 'Windows Terminal', 'Python'],
        acronyms: ['PATH', 'CLI', 'PTY', 'ID', 'WebGL', 'DOM'],
      }],
    },
  },
  {
    /* The settings tab implements the 1.13 declarative API and keeps
       `display()` ON PURPOSE as the fallback for Obsidian below 1.13 (the
       floor is 1.7.2), which is the case its deprecation notice carves out.
       Inline disables are forbidden by the recommended config, so the
       exemption lives here, scoped to the one file. */
    files: ['src/settings/SettingsTab.ts'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
  {
    files: ['styles.css'],
    plugins: { css },
    language: 'css/css',
    rules: {
      ...css.configs.recommended.rules,
      /* Checker limitations, not exemptions from the outcome: every colour and
         font routes through --ict-* tokens the static rule cannot resolve
         across selectors, and the DOM gate measures the resolved values. */
      'css/no-invalid-properties': 'off',
      'css/font-family-fallbacks': 'off',
    },
  },
  {
    ignores: ['main.js', 'node_modules/**', 'test/**', 'tools/**'],
  },
]);
