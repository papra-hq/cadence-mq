import { defineConfig } from 'oxfmt';

export default defineConfig({
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  printWidth: 100,
  sortPackageJson: true,
  arrowParens: 'always',
  insertFinalNewline: true,
  objectWrap: 'preserve',
  tabWidth: 2,
  useTabs: false,
  quoteProps: 'consistent',
  // Markdown inside MDX JSX children is indentation-sensitive and cannot be safely reformatted.
  ignorePatterns: ['**/*.mdx'],
});
