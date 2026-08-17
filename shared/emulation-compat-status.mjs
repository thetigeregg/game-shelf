export const EMULATION_COMPAT_STATUSES = Object.freeze(['perfect', 'playable', 'incomplete']);

export function isEmulationCompatStatus(value) {
  return typeof value === 'string' && EMULATION_COMPAT_STATUSES.includes(value);
}
