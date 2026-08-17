export type EmulationCompatStatus = 'perfect' | 'playable' | 'incomplete';

export const EMULATION_COMPAT_STATUSES: readonly EmulationCompatStatus[];

export function isEmulationCompatStatus(value: unknown): value is EmulationCompatStatus;
