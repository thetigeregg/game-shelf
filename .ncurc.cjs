const base = require('@thetigeregg/ncu-config');

const ANGULAR_MAJOR = 22;
const IONIC_MAJOR = 9;
const IONIC_ANGULAR_TOOLKIT_MAJOR = 13;

const isAngularPackage = (name) =>
  name.startsWith('@angular/') ||
  name.startsWith('@angular-devkit/') ||
  name.startsWith('@angular-eslint/') ||
  name === 'angular-eslint';

const isIonicAngularToolkitPackage = (name) => name === '@ionic/angular-toolkit';

const isIonicPackage = (name) => name.startsWith('@ionic/') && !isIonicAngularToolkitPackage(name);

module.exports = {
  ...base,
  target: (name) => {
    if (isAngularPackage(name) || isIonicPackage(name) || isIonicAngularToolkitPackage(name)) {
      return 'minor';
    }

    // Angular 22, typescript-eslint, and @ionic/angular-toolkit all peer on
    // typescript >=6.0 <6.1, and TypeScript minors can break — stay on patches.
    if (name === 'typescript') {
      return 'patch';
    }

    return base.target(name);
  },
  filterResults: (packageName, { upgradedVersionSemver }) => {
    if (isAngularPackage(packageName)) {
      return parseInt(upgradedVersionSemver?.major, 10) === ANGULAR_MAJOR;
    }

    if (isIonicPackage(packageName)) {
      return parseInt(upgradedVersionSemver?.major, 10) === IONIC_MAJOR;
    }

    if (isIonicAngularToolkitPackage(packageName)) {
      return parseInt(upgradedVersionSemver?.major, 10) === IONIC_ANGULAR_TOOLKIT_MAJOR;
    }

    return true;
  },
};
