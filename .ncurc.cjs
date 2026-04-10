const base = require('@thetigeregg/ncu-config');

module.exports = {
  ...base,
  reject: (name) => name === 'typescript',
};
