import { describe, expect, it } from 'vitest';
import { resolveEmulatorJsShader } from './emulatorjs-shader-map';

describe('resolveEmulatorJsShader', () => {
  it('returns normalized .glslp filenames for mapped platforms', () => {
    expect(resolveEmulatorJsShader(18)).toBe('crt-lottes.glslp');
    expect(resolveEmulatorJsShader(19)).toBe('crt-aperture.glslp');
    expect(resolveEmulatorJsShader(7)).toBe('crt-geom.glslp');
    expect(resolveEmulatorJsShader(79)).toBe('crt-easymode.glslp');
    expect(resolveEmulatorJsShader(62)).toBe('crt-caligari.glslp');
  });

  it('returns null for handheld / LCD mappings', () => {
    expect(resolveEmulatorJsShader(24)).toBeNull();
    expect(resolveEmulatorJsShader(61)).toBeNull();
  });

  it('returns null for unknown platform ids', () => {
    expect(resolveEmulatorJsShader(999)).toBeNull();
  });

  it('returns null for invalid ids', () => {
    expect(resolveEmulatorJsShader(0)).toBeNull();
    expect(resolveEmulatorJsShader(-1)).toBeNull();
    expect(resolveEmulatorJsShader(1.5 as unknown as number)).toBeNull();
  });
});
