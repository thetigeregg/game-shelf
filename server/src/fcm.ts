import { config } from './config.js';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type BatchResponse, type Messaging } from 'firebase-admin/messaging';

export interface FcmSendPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface FcmSendResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

let cachedServiceAccount: ServiceAccount | null = null;
let cachedServiceAccountError: Error | null = null;
let cachedMessaging: Messaging | null = null;
let loggedNotConfiguredWarning = false;

export function resetFcmStateForTests(): void {
  cachedServiceAccount = null;
  cachedServiceAccountError = null;
  cachedMessaging = null;
  loggedNotConfiguredWarning = false;
}

export function hasConfiguredFcm(): boolean {
  return config.firebaseServiceAccountJson.length > 0;
}

export async function sendFcmMulticast(
  tokens: string[],
  payload: FcmSendPayload
): Promise<FcmSendResult> {
  const activeTokens = [
    ...new Set(tokens.map((token) => token.trim()).filter((token) => token.length > 0)),
  ];

  if (activeTokens.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
    };
  }

  if (!hasConfiguredFcm()) {
    if (!loggedNotConfiguredWarning) {
      loggedNotConfiguredWarning = true;
      console.warn('[fcm] not_configured', { skippedTokenCount: activeTokens.length });
    }
    return {
      successCount: 0,
      failureCount: activeTokens.length,
      invalidTokens: [],
    };
  }

  const messaging = resolveMessaging();
  const tokenChunks = chunk(activeTokens, 500);
  const responses = await Promise.all(
    tokenChunks.map(async (tokenChunk) => {
      return messaging.sendEachForMulticast({
        tokens: tokenChunk,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      });
    })
  );

  let successCount = 0;
  let failureCount = 0;
  for (const response of responses) {
    successCount += response.successCount;
    failureCount += response.failureCount;
  }

  const { invalidTokens, failuresByCode } = summarizeFcmSendFailures(responses, tokenChunks);

  if (Object.keys(failuresByCode).length > 0) {
    // Codes and counts only — never log token values (they are delivery credentials).
    console.warn('[fcm] send_failures', { failuresByCode, successCount, failureCount });
  }

  return {
    successCount,
    failureCount,
    invalidTokens,
  };
}

const INVALID_TOKEN_ERROR_CODES = [
  'registration-token-not-registered',
  'invalid-registration-token',
];

/**
 * Splits per-token send failures into invalid-token deactivation candidates and a
 * `code -> count` summary of every other failure (e.g. messaging/third-party-auth-error).
 * Pure so it can be unit-tested without initializing Firebase.
 */
export function summarizeFcmSendFailures(
  responses: BatchResponse[],
  tokenChunks: string[][]
): { invalidTokens: string[]; failuresByCode: Record<string, number> } {
  const invalidTokens = new Set<string>();
  const failuresByCode: Record<string, number> = {};

  responses.forEach((response, chunkIndex) => {
    const tokenChunk = tokenChunks[chunkIndex] ?? [];

    response.responses.forEach((entry, entryIndex) => {
      if (entry.success) {
        return;
      }

      const code = entry.error?.code ?? '';
      const isInvalidToken = INVALID_TOKEN_ERROR_CODES.some((invalidCode) =>
        code.includes(invalidCode)
      );

      if (isInvalidToken) {
        const token = tokenChunk[entryIndex];
        if (token) {
          invalidTokens.add(token);
        }
        return;
      }

      const bucket = code.length > 0 ? code : 'unknown';
      failuresByCode[bucket] = (failuresByCode[bucket] ?? 0) + 1;
    });
  });

  return {
    invalidTokens: [...invalidTokens],
    failuresByCode,
  };
}

function resolveMessaging(): Messaging {
  if (cachedMessaging) {
    return cachedMessaging;
  }

  const apps = getApps();
  if (apps.length > 0) {
    // If Firebase is already initialized (for example by another module path),
    // prefer that runtime state over any previously cached parse failure.
    cachedServiceAccountError = null;
    cachedMessaging = getMessaging(apps[0]);
    return cachedMessaging;
  }

  const parsed = resolveServiceAccount();
  try {
    initializeApp({
      credential: cert(parsed),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isDuplicateInit = message.includes('already exists') || message.includes('duplicate-app');
    if (!isDuplicateInit) {
      throw error;
    }
  }

  cachedMessaging = getMessaging();
  return cachedMessaging;
}

function resolveServiceAccount(): ServiceAccount {
  if (cachedServiceAccount) {
    return cachedServiceAccount;
  }

  if (cachedServiceAccountError) {
    throw cachedServiceAccountError;
  }

  try {
    const parsedUnknown = JSON.parse(config.firebaseServiceAccountJson) as unknown;
    if (!parsedUnknown || typeof parsedUnknown !== 'object') {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object.');
    }
    cachedServiceAccount = parsedUnknown;
    return cachedServiceAccount;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON.';
    cachedServiceAccountError = new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${message}`);
    throw cachedServiceAccountError;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
