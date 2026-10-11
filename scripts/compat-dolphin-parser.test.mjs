import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DUMP_MISSING_ERROR_CODE, fetchList } from '../compat-scraper/src/parsers/dolphin.mjs';

function withDumpDir(run) {
  const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-dolphin-'));

  return Promise.resolve(run(dumpDir)).finally(() => {
    fs.rmSync(dumpDir, { recursive: true, force: true });
  });
}

test('fetchList tags a missing dump with the dump_missing code', async () => {
  await withDumpDir(async (dumpDir) => {
    await assert.rejects(fetchList(null, { platformSlug: 'gamecube', dumpDir }), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.code, DUMP_MISSING_ERROR_CODE);
      assert.equal(error.code, 'dump_missing');
      assert.match(error.message, /No compatibility dump found for platform "gamecube"/);
      return true;
    });
  });
});

test('fetchList does not report a present dump as missing', async () => {
  await withDumpDir(async (dumpDir) => {
    fs.writeFileSync(path.join(dumpDir, 'wii.html'), '<html><body></body></html>');

    assert.deepEqual(await fetchList(null, { platformSlug: 'wii', dumpDir }), []);
  });
});
