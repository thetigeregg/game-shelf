import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildInfoPlistXml,
  deepMergePlist,
  generateIosInfoPlists,
  mergeInfoPlistVariant,
  orderMergedPlistKeys,
  parseGenerateIosInfoPlistsArgs,
} from './generate-ios-info-plists.mjs';

test('deepMergePlist overlays scalars and merges nested dictionaries', () => {
  const merged = deepMergePlist(
    {
      CFBundleDisplayName: 'GameShelf',
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
      },
    },
    {
      CFBundleDisplayName: 'GameShelf Dev',
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
    }
  );

  assert.deepEqual(merged, {
    CFBundleDisplayName: 'GameShelf Dev',
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: true,
    },
  });
});

test('deepMergePlist replaces arrays wholesale', () => {
  const merged = deepMergePlist(
    { UIBackgroundModes: ['remote-notification'] },
    { UIBackgroundModes: ['fetch'] }
  );

  assert.deepEqual(merged.UIBackgroundModes, ['fetch']);
});

test('orderMergedPlistKeys follows canonical Info.plist key order', () => {
  const ordered = orderMergedPlistKeys({
    UIViewControllerBasedStatusBarAppearance: true,
    CFBundleDisplayName: 'GameShelf Dev',
    CAPACITOR_DEBUG: '$(CAPACITOR_DEBUG)',
  });

  assert.deepEqual(Object.keys(ordered), [
    'CAPACITOR_DEBUG',
    'CFBundleDisplayName',
    'UIViewControllerBasedStatusBarAppearance',
  ]);
});

test('mergeInfoPlistVariant merges shared and overlay plists from repo', () => {
  const repoRoot = process.cwd();
  const merged = mergeInfoPlistVariant({
    sharedPath: path.join(repoRoot, 'ios/App/App/Info.shared.plist'),
    overlayPath: path.join(repoRoot, 'ios/App/App/Info.dev.overlay.plist'),
  });

  assert.equal(merged.CFBundleDisplayName, 'GameShelf Dev');
  assert.equal(merged.ITSAppUsesNonExemptEncryption, false);
  assert.equal(merged.NSAppTransportSecurity.NSAllowsLocalNetworking, true);
  assert.equal(
    merged.NSLocalNetworkUsageDescription,
    'Game Shelf needs access to your local network to connect to the development server on your computer.'
  );
  assert.equal(merged.CAPACITOR_DEBUG, '$(CAPACITOR_DEBUG)');
});

test('generateIosInfoPlists writes outputs matching committed Info plists', () => {
  const repoRoot = process.cwd();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ios-info-plist-'));
  const outputs = {};

  generateIosInfoPlists({
    repoRoot,
    writeFileSyncFn: (filePath, contents) => {
      outputs[path.relative(repoRoot, filePath)] = contents;
    },
    log: () => undefined,
  });

  assert.equal(
    outputs['ios/App/App/Info.dev.plist'],
    readFileSync(path.join(repoRoot, 'ios/App/App/Info.dev.plist'), 'utf8')
  );
  assert.equal(
    outputs['ios/App/App/Info.prod.plist'],
    readFileSync(path.join(repoRoot, 'ios/App/App/Info.prod.plist'), 'utf8')
  );

  writeFileSync(path.join(tempDir, 'done'), 'ok');
});

test('generateIosInfoPlists with write:false performs a dry run without writing', () => {
  const writeCalls = [];

  generateIosInfoPlists({
    repoRoot: process.cwd(),
    write: false,
    writeFileSyncFn: (filePath) => {
      writeCalls.push(filePath);
    },
    log: () => undefined,
  });

  assert.equal(writeCalls.length, 0);
});

test('generateIosInfoPlists --check passes when outputs are current', () => {
  assert.doesNotThrow(() => {
    generateIosInfoPlists({
      repoRoot: process.cwd(),
      check: true,
      write: false,
    });
  });
});

test('generateIosInfoPlists --check fails when outputs are stale', () => {
  assert.throws(
    () =>
      generateIosInfoPlists({
        repoRoot: process.cwd(),
        check: true,
        write: false,
        readFileSyncFn: (filePath) => {
          if (filePath.endsWith('Info.dev.plist')) {
            return 'stale';
          }

          return readFileSync(filePath, 'utf8');
        },
      }),
    /stale for: ios\/App\/App\/Info\.dev\.plist/
  );
});

test('parseGenerateIosInfoPlistsArgs recognizes --check', () => {
  assert.deepEqual(parseGenerateIosInfoPlistsArgs(['--check']), { check: true });
  assert.deepEqual(parseGenerateIosInfoPlistsArgs([]), { check: false });
});

test('buildInfoPlistXml emits XML plist with trailing newline', () => {
  const xml = buildInfoPlistXml({ CFBundleDisplayName: 'GameShelf' });

  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<key>CFBundleDisplayName<\/key>/);
  assert.ok(xml.endsWith('\n'));
});
