import { describe, expect, it } from 'vitest';
import { StrictHttpParameterCodec } from './strict-http-parameter-codec';

describe('StrictHttpParameterCodec', () => {
  const codec = new StrictHttpParameterCodec();

  it('encodes key using encodeURIComponent', () => {
    expect(codec.encodeKey('hello world')).toBe('hello%20world');
    expect(codec.encodeKey('key=value')).toBe('key%3Dvalue');
    expect(codec.encodeKey('a&b')).toBe('a%26b');
  });

  it('encodes value using encodeURIComponent', () => {
    expect(codec.encodeValue('foo bar')).toBe('foo%20bar');
    expect(codec.encodeValue('100%')).toBe('100%25');
  });

  it('decodes key using decodeURIComponent', () => {
    expect(codec.decodeKey('hello%20world')).toBe('hello world');
    expect(codec.decodeKey('key%3Dvalue')).toBe('key=value');
  });

  it('decodes value using decodeURIComponent', () => {
    expect(codec.decodeValue('foo%20bar')).toBe('foo bar');
    expect(codec.decodeValue('100%25')).toBe('100%');
  });

  it('round-trips key through encode then decode', () => {
    const original = 'platform name/id=1&page=2';
    expect(codec.decodeKey(codec.encodeKey(original))).toBe(original);
  });

  it('round-trips value through encode then decode', () => {
    const original = 'some value with spaces & symbols';
    expect(codec.decodeValue(codec.encodeValue(original))).toBe(original);
  });
});
