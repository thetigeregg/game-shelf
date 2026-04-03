module.exports = {
  ...require('@thetigeregg/lint-staged-config'),
  '*.{ts,js,mjs,cjs}': 'eslint --fix',
};
