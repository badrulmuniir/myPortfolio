// ESLint flat config for the Frontend (Requirements 9.7, 32.12).
// eslint-plugin-react 7.x supports ESLint up to 9, so ESLint stays on 9.x.
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // React Compiler diagnostics that conflict with deliberate patterns here (the app does
      // not use the compiler): latest-value refs written during render, and effects that
      // reset state synchronously before subscribing or fetching.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      // Rest destructuring is used to omit fields from an object.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // No raw HTML injection anywhere in the app (Requirement 9.7).
      'react/no-danger': 'error',
      // Function components and hooks only (Requirement 32.12).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(ClassDeclaration, ClassExpression)[superClass.name=/^(Pure)?Component$/], ' +
            ':matches(ClassDeclaration, ClassExpression)[superClass.property.name=/^(Pure)?Component$/]',
          message: 'Use a function component with hooks instead of a class component.',
        },
      ],
      // The project is plain JavaScript without PropTypes.
      'react/prop-types': 'off',
    },
  },

  // Test files and the Vitest setup run under Node with jsdom.
  {
    files: ['src/**/*.test.{js,jsx}', 'src/setupTests.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Test probe components capture hook results into module variables on purpose.
      'react-hooks/globals': 'off',
    },
  },

  // Build tooling runs under Node.
  {
    files: ['vite.config.js', 'eslint.config.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
