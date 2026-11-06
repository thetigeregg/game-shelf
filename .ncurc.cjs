const base = require('@thetigeregg/ncu-config');

const isAngularPackage = (name) =>
  name.startsWith('@angular/') ||
  name.startsWith('@angular-devkit/') ||
  name.startsWith('@angular-eslint/') ||
  name === 'angular-eslint';

const isIonicPackage = (name) => name.startsWith('@ionic/');

module.exports = {
  ...base,
  target: (name) => {
    // Majors for these move together via `ng update` / `@ionic/migrate`, so ncu
    // only proposes minors and patches within the installed major.
    if (isAngularPackage(name) || isIonicPackage(name)) {
      return 'minor';
    }

    // Angular 22 (@angular/build, @angular/compiler-cli) peers on
    // typescript >=6.0 <6.1 and typescript-eslint on <6.1.0, and TypeScript
    // minors can break — stay on patches.
    if (name === 'typescript') {
      return 'patch';
    }

    return base.target(name);
  },
};
