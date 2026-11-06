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
    // minors can break — stay on patches. TypeScript 7 (native port) also
    // drops the classic JS compiler API (only `typescript/unstable/*`), which
    // both of those depend on — so the root can't move to 7 until they ship
    // support. server/ is already on 7, since it only uses the `tsc` binary.
    if (name === 'typescript') {
      return 'patch';
    }

    // Only installed to satisfy @capacitor-firebase/messaging's (optional) peer —
    // its web.js imports firebase/messaging, so it must stay a direct dep. The
    // plugin peers on firebase ^12, so hold the major until it accepts the next.
    if (name === 'firebase') {
      return 'minor';
    }

    return base.target(name);
  },
};
