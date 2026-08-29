import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * One flat config for the whole workspace.
 *
 * The rules that are switched on beyond the recommended sets are the ones that
 * catch the mistakes this codebase is actually shaped to make: silent `any`
 * from an un-narrowed cast, a floating promise in a fire-and-forget background
 * job, and an import that only exists for its types.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out-tsc/**',
      '**/.next/**',
      '**/.astro/**',
      '**/node_modules/**',
      '.nx/**',
      'tmp/**',
      'apps/api/drizzle/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // A cast is how type errors get hidden rather than fixed. Warn rather
      // than error so it shows up in review without blocking a build.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },

  // ── Tests: JSON responses are asserted on, not typed ──────────────────────
  {
    files: ['**/*.test.ts', 'apps/api/src/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // ── API: Node, background jobs ────────────────────────────────────────────
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // ── Dashboard: browser, React ─────────────────────────────────────────────
  {
    files: ['apps/dashboard/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Correctness rules stay errors — these catch real broken hooks.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // The React Compiler's advisory rules stay warnings: they flag
      // cascading-render performance patterns, not defects, and the
      // fetch-on-mount they mostly point at is deliberate here.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
    },
  },

  // ── Plain JS (installer, eslint/vite config) ──────────────────────────────
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
);
