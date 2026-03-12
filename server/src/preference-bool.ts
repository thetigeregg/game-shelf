const DISABLED_PREFERENCE_STRINGS = new Set(['false', '0', 'no']);
const ENABLED_PREFERENCE_STRINGS = new Set(['true', '1', 'yes']);

export function coercePreferenceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    if (value === 0) {
      return false;
    }
    if (value === 1) {
      return true;
    }
    return fallback;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (DISABLED_PREFERENCE_STRINGS.has(normalized)) {
      return false;
    }
    if (ENABLED_PREFERENCE_STRINGS.has(normalized)) {
      return true;
    }
  }

  return fallback;
}
