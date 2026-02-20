module.exports = {
  target: (name, semver) => {
    if (name.startsWith('@types/node')) {
      return 'minor';
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
