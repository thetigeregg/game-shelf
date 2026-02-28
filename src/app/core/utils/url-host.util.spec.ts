import { describe, expect, it } from 'vitest';
import { detectReviewSourceFromUrl, hostIsDomainOrSubdomain, parseHttpUrl } from './url-host.util';

describe('url-host util', () => {
  it('detects supported review sources by exact host and subdomain', () => {
    expect(detectReviewSourceFromUrl('https://mobygames.com/game/foo')).toBe('mobygames');
    expect(detectReviewSourceFromUrl('https://www.mobygames.com/game/foo')).toBe('mobygames');
    expect(detectReviewSourceFromUrl('https://metacritic.com/game/foo')).toBe('metacritic');
    expect(detectReviewSourceFromUrl('https://www.metacritic.com/game/foo')).toBe('metacritic');
  });

  it('rejects lookalike hosts and unrelated hosts', () => {
    expect(detectReviewSourceFromUrl('https://mobygames.com.evil.example/game/foo')).toBeNull();
    expect(detectReviewSourceFromUrl('https://evil.example/?q=metacritic.com')).toBeNull();
  });

  it('rejects non-http protocols and schemeless inputs', () => {
    expect(detectReviewSourceFromUrl('javascript:alert(1)')).toBeNull();
    expect(detectReviewSourceFromUrl('data:text/html,metacritic.com')).toBeNull();
    expect(detectReviewSourceFromUrl('metacritic.com/game/foo')).toBeNull();
  });

  it('supports protocol-relative URLs', () => {
    expect(detectReviewSourceFromUrl('//www.metacritic.com/game/foo')).toBe('metacritic');
  });

  it('parses only absolute http(s) urls', () => {
    expect(parseHttpUrl('https://www.mobygames.com/game/foo')).not.toBeNull();
    expect(parseHttpUrl('//www.mobygames.com/game/foo')).not.toBeNull();
    expect(parseHttpUrl('/local/path')).toBeNull();
  });

  it('validates hostname match against base domain safely', () => {
    expect(hostIsDomainOrSubdomain('www.metacritic.com', 'metacritic.com')).toBe(true);
    expect(hostIsDomainOrSubdomain('metacritic.com.evil.example', 'metacritic.com')).toBe(false);
  });
});
