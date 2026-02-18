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

  it('supports rate-limit messages passed directly as strings', () => {
    expect(formatRateLimitedUiError('429 - retry after 8s', 'fallback')).toBe(
      'Rate limited. Retry after 8s.'
    );
  });

  it('supports plain object error message fields', () => {
    expect(
      formatRateLimitedUiError({ message: 'Too many requests from upstream' }, 'fallback')
    ).toBe('Rate limited. Please retry shortly.');
  });

  it('supports plain object error detail fields', () => {
    expect(formatRateLimitedUiError({ detail: 'Rate limit reached' }, 'fallback')).toBe(
      'Rate limited. Please retry shortly.'
    );
  });

  it('returns fallback for unrecognized object payloads', () => {
    expect(formatRateLimitedUiError({ code: 429 }, 'fallback')).toBe('fallback');
  });
});
