import antfu from '@antfu/eslint-config';

export default antfu({
  stylistic: {
    semi: true,
  },

  rules: {
    'antfu/no-top-level-await': 'off',
    'no-console': 'off',
    'node/prefer-global/process': 'off',
    // To allow export on top of files
    'ts/no-use-before-define': ['error', { allowNamedExports: true, functions: false }],
    'curly': ['error', 'all'],
    'vitest/consistent-test-it': ['error', { fn: 'test' }],
    'ts/consistent-type-definitions': ['error', 'type'],
    'style/brace-style': ['error', '1tbs', { allowSingleLine: false }],
    'unused-imports/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
  },
});
