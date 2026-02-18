module.exports = {
  target: (name, semver) => {
    if (
      name.startsWith('@angular/') ||
      name.startsWith('@angular-devkit/') ||
      name.startsWith('@angular-eslint/') ||
      name.startsWith('@types/node') ||
      name === 'eslint'
    ) {
      return 'minor';
    }

    if (name.startsWith('zone.js')) {
      return 'patch';
    }

    return 'latest';
  },
  reject: (name, semver) => {
    if (name === 'typescript') {
      return true;
    }

    return false;
  }
};
