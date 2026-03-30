export const APPROVED_BRIGHT_FILLED_ACTION_SURFACE_COLORS = [
  'primary',
  'tertiary',
  'forest',
  'medium',
] as const;

export type FilledActionSurfaceColor =
  (typeof APPROVED_BRIGHT_FILLED_ACTION_SURFACE_COLORS)[number];

// Filled Ionic controls inherit foreground color from the active color's contrast token.
// Keep these actions on the bright family so dark mode uses the same dark icon/text treatment.
export const LIST_PAGE_FAB_COLORS = {
  trigger: 'primary',
  search: 'tertiary',
  add: 'forest',
  scrollTop: 'medium',
} as const satisfies Record<string, FilledActionSurfaceColor>;

export const DETAIL_SHORTCUT_FAB_COLORS = {
  trigger: 'primary',
  notes: 'medium',
  manual: 'primary',
  websites: 'tertiary',
  videos: 'forest',
} as const satisfies Record<string, FilledActionSurfaceColor>;

export const GLOBAL_CREATE_FAB_COLOR = 'primary' as const satisfies FilledActionSurfaceColor;
