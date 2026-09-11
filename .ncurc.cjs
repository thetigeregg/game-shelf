const base = require('@thetigeregg/ncu-config');

const ANGULAR_MAJOR = 21;
const IONIC_MAJOR = 8;

const isAngularPackage = (name) =>
  name.startsWith('@angular/') || name.startsWith('@angular-eslint/');

const isIonicPackage = (name) => name.startsWith('@ionic/');

module.exports = {
  ...base,
  reject: (name) => name === 'typescript',
  filterResults: (packageName, { upgradedVersionSemver }) => {
    if (isAngularPackage(packageName)) {
      return parseInt(upgradedVersionSemver?.major, 10) === ANGULAR_MAJOR;
    }

    if (isIonicPackage(packageName)) {
      return parseInt(upgradedVersionSemver?.major, 10) === IONIC_MAJOR;
    }

    return true;
  },
};
