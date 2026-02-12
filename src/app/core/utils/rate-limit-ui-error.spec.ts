import { formatRateLimitedUiError } from './rate-limit-ui-error';

describe('rate-limit-ui-error', () => {
  it('returns retry timing when present', () => {
    const error = new Error('Rate limit exceeded. Retry after 17s.');
    expect(formatRateLimitedUiError(error, 'fallback')).toBe('Rate limited. Retry after 17s.');
  });

  it('returns generic rate-limit message without retry timing', () => {
    const error = new Error('Too many requests');
    expect(formatRateLimitedUiError(error, 'fallback')).toBe('Rate limited. Please retry shortly.');
  });

  it('returns fallback for non-rate-limit errors', () => {
    const error = new Error('Unable to load');
    expect(formatRateLimitedUiError(error, 'fallback')).toBe('fallback');
  });

  it('returns fallback for missing errors', () => {
    expect(formatRateLimitedUiError(null, 'fallback')).toBe('fallback');
  });
});

