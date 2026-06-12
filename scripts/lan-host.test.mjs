import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeLocalBackendOrigin,
  formatSuggestedIosLocalOrigin,
  resolveLanHost,
  resolveManualsPublicBaseUrl,
} from './lan-host.mjs';

test('resolveLanHost prefers IOS_LAN_HOST when set', () => {
  assert.equal(resolveLanHost({ IOS_LAN_HOST: '192.168.1.42' }), '192.168.1.42');
});

test('resolveLanHost picks en0 private IPv4 before other interfaces', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        en5: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
        en0: [{ family: 'IPv4', internal: false, address: '192.168.0.21' }],
      }),
    }
  );

  assert.equal(host, '192.168.0.21');
});

test('resolveLanHost falls back to any private IPv4 address', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        utun4: [{ family: 'IPv4', internal: false, address: '10.20.30.40' }],
      }),
    }
  );

  assert.equal(host, '10.20.30.40');
});

test('resolveLanHost returns null when no suitable address exists', () => {
  const host = resolveLanHost(
    {},
    {
      networkInterfaces: () => ({
        lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      }),
    }
  );

  assert.equal(host, null);
});

test('composeLocalBackendOrigin builds http origin from host and edge port', () => {
  assert.equal(composeLocalBackendOrigin('192.168.0.21', 11621), 'http://192.168.0.21:11621');
  assert.equal(composeLocalBackendOrigin('', 8080), null);
  assert.equal(composeLocalBackendOrigin('192.168.0.21', 0), null);
});

test('formatSuggestedIosLocalOrigin mirrors composeLocalBackendOrigin', () => {
  assert.equal(formatSuggestedIosLocalOrigin('192.168.0.21', 11621), 'http://192.168.0.21:11621');
});

test('resolveManualsPublicBaseUrl prefers an absolute MANUALS_PUBLIC_BASE_URL override', () => {
  assert.equal(
    resolveManualsPublicBaseUrl(
      { MANUALS_PUBLIC_BASE_URL: 'http://192.168.0.99:12000/manuals/' },
      8080
    ),
    'http://192.168.0.99:12000/manuals'
  );
});

test('resolveManualsPublicBaseUrl composes LAN manuals origin from IOS_LAN_HOST', () => {
  assert.equal(
    resolveManualsPublicBaseUrl({ IOS_LAN_HOST: '192.168.0.21' }, 10028),
    'http://192.168.0.21:10028/manuals'
  );
});

test('resolveManualsPublicBaseUrl falls back to localhost when LAN host is unavailable', () => {
  assert.equal(
    resolveManualsPublicBaseUrl({}, 10028, {
      networkInterfaces: () => ({
        lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      }),
    }),
    'http://127.0.0.1:10028/manuals'
  );
});
