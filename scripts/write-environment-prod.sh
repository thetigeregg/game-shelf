#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"

if [[ "${mode}" != "prod" && "${mode}" != "ci" ]]; then
  echo "Usage: $0 <prod|ci>" >&2
  exit 1
fi

# EmulatorJS: `environment.emulatorJsPathToData` is the HTTPS base URL passed through to the play
# shell as EmulatorJS `EJS_pathtodata` (static hosting on GitHub Pages from `game-shelf-assets`).
# Default comes from `EMULATORJS_DEFAULT_PATH_TO_DATA` in `emulatorjs.constants.ts`.
# After each assets deploy, SRI must match `entrypoints.loader.sri.sha384` in the published manifest
# (`EMULATORJS_ASSETS_MANIFEST_URL` in the same file).
# Optional `EMULATORJS_PATH_TO_DATA_PROD` / `EMULATORJS_LOADER_INTEGRITY_PROD` must match the
# allowlist and SRI expectations enforced in `emulatorjs-play-url.ts` and `play.html`.
emulatorjs_constants_json="$(
  node -e 'const fs=require("fs");const vm=require("vm");const source=fs.readFileSync("src/app/core/config/emulatorjs.constants.ts","utf8");const transformed=source.replace(/^\s*export\s+const\s+/gm,"const ");const context={result:null};const vmSource=transformed+"\nresult={pathToData:EMULATORJS_DEFAULT_PATH_TO_DATA,loaderIntegrity:EMULATORJS_PINNED_LOADER_INTEGRITY};";vm.runInNewContext(vmSource,context);const result=context.result;if(!result||typeof result.pathToData!=="string"||result.pathToData.length===0||typeof result.loaderIntegrity!=="string"||result.loaderIntegrity.length===0){process.exit(1);}process.stdout.write(JSON.stringify(result));'
)"
emulatorjs_path_to_data_default="$(node -e 'const payload=JSON.parse(process.argv[1]);process.stdout.write(payload.pathToData);' "${emulatorjs_constants_json}")"
emulatorjs_path_to_data="${EMULATORJS_PATH_TO_DATA_PROD:-$emulatorjs_path_to_data_default}"
emulatorjs_loader_integrity_default="$(node -e 'const payload=JSON.parse(process.argv[1]);process.stdout.write(payload.loaderIntegrity);' "${emulatorjs_constants_json}")"
if [[ "${emulatorjs_path_to_data}" == "${emulatorjs_path_to_data_default}" ]]; then
  emulatorjs_loader_integrity="${EMULATORJS_LOADER_INTEGRITY_PROD:-$emulatorjs_loader_integrity_default}"
else
  if [[ -z "${EMULATORJS_LOADER_INTEGRITY_PROD:-}" ]]; then
    echo "Missing required secret: EMULATORJS_LOADER_INTEGRITY_PROD when EMULATORJS_PATH_TO_DATA_PROD overrides the default path" >&2
    exit 1
  fi
  emulatorjs_loader_integrity="${EMULATORJS_LOADER_INTEGRITY_PROD}"
fi

escape_ts_string() {
  local value="${1}"
  value="${value//\\/\\\\}"
  value="${value//\'/\\\'}"
  value="${value//$'\n'/\\n}"
  printf '%s' "${value}"
}

cat > src/environments/environment.prod.ts <<EOF
export const environment = {
  production: true,
  gameApiBaseUrl: '/api',
  manualsBaseUrl: '/manuals',
  romsBaseUrl: '/roms',
  biosBaseUrl: '/bios',
  emulatorJsPathToData: '$(escape_ts_string "${emulatorjs_path_to_data}")',
  emulatorJsLoaderIntegrity: '$(escape_ts_string "${emulatorjs_loader_integrity}")',
  emulatorJsDebug: false,
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: false,
    requireAuth: true,
  },
};
EOF
