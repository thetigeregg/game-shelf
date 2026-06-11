import assert from 'node:assert/strict';
import test from 'node:test';

import { loadProjectEnv, parseDotEnv } from './dotenv.mjs';

test('parseDotEnv ignores comments and parses quoted values', () => {
  assert.deepEqual(
    parseDotEnv(`
# comment
IOS_LAN_HOST="192.168.0.21"
IOS_TARGET_NAME="Jake's iPhone"
`),
    {
      IOS_LAN_HOST: '192.168.0.21',
      IOS_TARGET_NAME: "Jake's iPhone",
    }
  );
});

test('loadProjectEnv merges .env values and lets process env override', () => {
  const env = loadProjectEnv(
    {
      IOS_LAN_HOST: '10.0.0.2',
      PATH: '/usr/bin',
    },
    {
      dotenvValues: {
        IOS_LAN_HOST: '192.168.0.21',
        IOS_TARGET_NAME: 'Your iPhone',
      },
    }
  );

  assert.equal(env.IOS_LAN_HOST, '10.0.0.2');
  assert.equal(env.IOS_TARGET_NAME, 'Your iPhone');
  assert.equal(env.PATH, '/usr/bin');
});
