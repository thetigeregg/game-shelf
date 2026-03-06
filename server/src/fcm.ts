import { config } from './config.js';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

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

export function hasConfiguredFcm(): boolean {
  return config.firebaseServiceAccountJson.length > 0;
}

export async function sendFcmMulticast(
  tokens: string[],
  payload: FcmSendPayload
): Promise<FcmSendResult> {
  const activeTokens = [
    ...new Set(tokens.map((token) => token.trim()).filter((token) => token.length > 0))
  ];

  if (activeTokens.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
      invalidTokens: []
    };
  }

  if (!hasConfiguredFcm()) {
    return {
      successCount: 0,
      failureCount: activeTokens.length,
      invalidTokens: []
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
          body: payload.body
        },
        data: payload.data
      });
    })
  );

  const invalidTokens: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < responses.length; i += 1) {
    const response = responses[i];
    const tokenChunk = tokenChunks[i] ?? [];
    successCount += response.successCount;
    failureCount += response.failureCount;

    response.responses.forEach((entry, entryIndex) => {
      if (entry.success) {
        return;
      }

      const code = entry.error?.code ?? '';
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token')
      ) {
        const token = tokenChunk[entryIndex];
        if (token) {
          invalidTokens.push(token);
        }
      }
    });
  }

  return {
    successCount,
    failureCount,
    invalidTokens: [...new Set(invalidTokens)]
  };
}

function resolveMessaging(): Messaging {
  if (getApps().length === 0) {
    const parsed = JSON.parse(config.firebaseServiceAccountJson) as ServiceAccount;
    initializeApp({
      credential: cert(parsed)
    });
  }

  return getMessaging();
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
