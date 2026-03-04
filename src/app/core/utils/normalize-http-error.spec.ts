import { normalizeHttpError } from './normalize-http-error';

describe('normalizeHttpError', () => {
  it('returns scalar fallback for non-object values', () => {
    expect(normalizeHttpError('boom')).toEqual({ value: 'boom' });
  });

  it('normalizes known HTTP-like fields from object values', () => {
    expect(
      normalizeHttpError({
        name: 'HttpErrorResponse',
        message: 'Bad Gateway',
        status: 502,
        statusText: 'Bad Gateway',
        url: 'http://localhost:3000/v1/manuals/resolve',
        ok: false
      })
    ).toEqual({
      name: 'HttpErrorResponse',
      message: 'Bad Gateway',
      status: 502,
      statusText: 'Bad Gateway',
      url: 'http://localhost:3000/v1/manuals/resolve',
      ok: false
    });
  });
});
