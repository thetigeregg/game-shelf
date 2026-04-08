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
