const typescriptEslint = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');
const prettierPlugin = require('eslint-plugin-prettier');
const importPlugin = require('eslint-plugin-import');
const securityPlugin = require('eslint-plugin-security');

module.exports = [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      prettier: prettierPlugin,
      import: importPlugin,
      security: securityPlugin,
    },
    rules: {
      // Base ESLint rules
      'prefer-const': 'error',
      'no-var': 'error',
      'no-unused-vars': 'off', // Use TypeScript version
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-console': 'off', // We use console for logging

      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-var-requires': 'error',

      // Import rules (simplified)
      'import/no-duplicates': 'error',

      // Security rules (basic ones that work)
      'security/detect-object-injection': 'warn',

      // Prettier integration
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '*.js.map',
      '*.d.ts.map',
      'logs/**',
      '*.log',
      '*.db',
      '*.sqlite',
      '.env*',
      'package-lock.json',
      'yarn.lock',
      '.vscode/**',
      '.idea/**',
      '.DS_Store',
      'Thumbs.db',
      'prisma/generated/**',
    ],
  },
];
