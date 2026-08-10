module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'vite.config.ts', 'playwright.config.ts', '*.config.js'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // Localized, acknowledged technical debt.
      //
      // `board-app.tsx` grew out of the engine's static demo: it is imperative DOM
      // with `any` in element queries and handlers. The rule stays an ERROR
      // everywhere else — new code cannot add `any` — and here it is a warning so
      // CI can be green without hiding the problem.
      //
      // The way out is not a single rewrite: it is extracting rules into
      // `src/lib/` with tests (that is how workspace-sync, share and uploads
      // happened) until this file is only DOM assembly. When you touch part of it,
      // type what you touch; do not add new `any`.
      files: ['src/pages/board-app.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },
    {
      // Tests may use `any` in doubles, where the real type would require
      // implementing an entire interface with no safety gain.
      files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },
  ],
};
