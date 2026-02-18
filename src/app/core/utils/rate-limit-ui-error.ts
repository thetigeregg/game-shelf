export function formatRateLimitedUiError(error: unknown, fallbackMessage: string): string {
  const message = extractErrorMessage(error);

  if (!message) {
    return fallbackMessage;
  }

  if (!isRateLimitedMessage(message)) {
    return fallbackMessage;
  }

  const retryAfterSeconds = extractRetryAfterSeconds(message);

  if (retryAfterSeconds !== null) {
    return `Rate limited. Retry after ${retryAfterSeconds}s.`;
  }

  return 'Rate limited. Please retry shortly.';
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string') {
      return message;
    }

    const detail = (error as { detail?: unknown }).detail;

    if (typeof detail === 'string') {
      return detail;
    }
  }

  return '';
}

function isRateLimitedMessage(message: string): boolean {
  return /rate limit|too many requests|429/i.test(message);
}

function extractRetryAfterSeconds(message: string): number | null {
  const match = message.match(/retry after\s+(\d+)\s*s/i);

  if (!match) {
    return null;
  }

  const seconds = Number.parseInt(match[1], 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}
