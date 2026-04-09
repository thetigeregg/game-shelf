#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"

if [[ "${mode}" != "prod" && "${mode}" != "ci" ]]; then
  echo "Usage: $0 <prod|ci>" >&2
  exit 1
fi

required=(
  FIREBASE_API_KEY_PROD
  FIREBASE_AUTH_DOMAIN_PROD
  FIREBASE_PROJECT_ID_PROD
  FIREBASE_STORAGE_BUCKET_PROD
  FIREBASE_MESSAGING_SENDER_ID_PROD
  FIREBASE_APP_ID_PROD
  FIREBASE_VAPID_KEY_PROD
)

if [[ "${mode}" == "prod" ]]; then
  for key in "${required[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      echo "Missing required secret: ${key}" >&2
      exit 1
    fi
  done
fi

fallback='ci-placeholder'
firebase_api_key="${FIREBASE_API_KEY_PROD:-$fallback}"
firebase_auth_domain="${FIREBASE_AUTH_DOMAIN_PROD:-$fallback}"
firebase_project_id="${FIREBASE_PROJECT_ID_PROD:-$fallback}"
firebase_storage_bucket="${FIREBASE_STORAGE_BUCKET_PROD:-$fallback}"
firebase_messaging_sender_id="${FIREBASE_MESSAGING_SENDER_ID_PROD:-$fallback}"
firebase_app_id="${FIREBASE_APP_ID_PROD:-$fallback}"
firebase_vapid_key="${FIREBASE_VAPID_KEY_PROD:-$fallback}"

emulatorjs_constants_json="$(node -e 'const fs=require("fs");const vm=require("vm");const source=fs.readFileSync("src/app/core/config/emulatorjs.constants.ts","utf8");const transformed=source.replace(/^\s*export\s+const\s+/gm,"const ");const context={result:null};vm.runInNewContext(`${transformed}\nresult={pathToData:EMULATORJS_DEFAULT_PATH_TO_DATA,loaderIntegrity:EMULATORJS_PINNED_LOADER_INTEGRITY};`,context);const result=context.result;if(!result||typeof result.pathToData!=="string"||result.pathToData.length===0||typeof result.loaderIntegrity!=="string"||result.loaderIntegrity.length===0){process.exit(1);}process.stdout.write(JSON.stringify(result));')"
emulatorjs_path_to_data_default="$(node -e 'const payload=JSON.parse(process.argv[1]);process.stdout.write(payload.pathToData);' "${emulatorjs_constants_json}")"
emulatorjs_path_to_data="${EMULATORJS_PATH_TO_DATA_PROD:-$emulatorjs_path_to_data_default}"
emulatorjs_loader_integrity_default="$(node -e 'const payload=JSON.parse(process.argv[1]);process.stdout.write(payload.loaderIntegrity);' "${emulatorjs_constants_json}")"
if [[ "${emulatorjs_path_to_data}" == "${emulatorjs_path_to_data_default}" ]]; then
  emulatorjs_loader_integrity="${EMULATORJS_LOADER_INTEGRITY_PROD:-$emulatorjs_loader_integrity_default}"
else
  emulatorjs_loader_integrity="${EMULATORJS_LOADER_INTEGRITY_PROD:-}"
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
  firebase: {
    apiKey: '$(escape_ts_string "${firebase_api_key}")',
    authDomain: '$(escape_ts_string "${firebase_auth_domain}")',
    projectId: '$(escape_ts_string "${firebase_project_id}")',
    storageBucket: '$(escape_ts_string "${firebase_storage_bucket}")',
    messagingSenderId: '$(escape_ts_string "${firebase_messaging_sender_id}")',
    appId: '$(escape_ts_string "${firebase_app_id}")',
  },
  firebaseVapidKey: '$(escape_ts_string "${firebase_vapid_key}")',
  featureFlags: {
    showMgcImport: false,
    e2eFixtures: false,
    recommendationsExploreEnabled: true,
    tasEnabled: false,
  },
};
EOF
