const base = require('@thetigeregg/ncu-config');

const ANGULAR_MAJOR = 21;

const isAngularPackage = (name) =>
  name.startsWith('@angular/') || name.startsWith('@angular-eslint/');

module.exports = {
  ...base,
  reject: (name) => name === 'typescript',
  filterResults: (packageName, { upgradedVersionSemver }) => {
    if (!isAngularPackage(packageName)) {
      return true;
    }

    return parseInt(upgradedVersionSemver?.major, 10) === ANGULAR_MAJOR;
  },
};
