EmulatorJS runtime assets can be stored in this directory for reference or self-hosted runtime use.

Expected minimum files:

- `loader.js`
- supporting EmulatorJS core/data files referenced by `loader.js`

Current app behavior:

- The app allows either same-origin `/assets/emulatorjs/data/` or the pinned release runtime URL configured in environment defaults.
- Do not point the app at arbitrary third-party runtime paths.

Security guidance for pinned assets in this folder:

1. Pin an explicit EmulatorJS release/version when copying files into this folder.
2. Compute SRI for `loader.js` and set `emulatorJsLoaderIntegrity` in environment config.

Example SRI generation:

```bash
openssl dgst -sha384 -binary "src/assets/emulatorjs/data/loader.js" | openssl base64 -A
```

Then set:

```ts
emulatorJsLoaderIntegrity: 'sha384-<base64 hash>';
```
