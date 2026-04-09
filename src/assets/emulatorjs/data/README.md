Self-hosted EmulatorJS runtime assets live in this directory.

Expected minimum files:

- `loader.js`
- supporting EmulatorJS core/data files referenced by `loader.js`

Security guidance:

1. Pin an explicit EmulatorJS release/version when copying files into this folder.
2. Do not point the app at third-party CDN runtime paths.
3. Compute SRI for `loader.js` and set `emulatorJsLoaderIntegrity` in environment config.

Example SRI generation:

```bash
openssl dgst -sha384 -binary "src/assets/emulatorjs/data/loader.js" | openssl base64 -A
```

Then set:

```ts
emulatorJsLoaderIntegrity: 'sha384-<base64 hash>';
```
