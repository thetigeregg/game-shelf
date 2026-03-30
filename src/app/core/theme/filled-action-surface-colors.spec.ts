import { describe, expect, it } from 'vitest';
import {
  APPROVED_BRIGHT_FILLED_ACTION_SURFACE_COLORS,
  DETAIL_SHORTCUT_FAB_COLORS,
  GLOBAL_CREATE_FAB_COLOR,
  LIST_PAGE_FAB_COLORS,
} from './filled-action-surface-colors';

describe('filled action surface colors', () => {
  it('keeps list-page fabs on the approved bright contrast family', () => {
    expect(LIST_PAGE_FAB_COLORS).toEqual({
      trigger: 'primary',
      search: 'tertiary',
      add: 'forest',
      scrollTop: 'medium',
    });
  });

  it('keeps detail shortcut fabs on the approved bright contrast family', () => {
    expect(DETAIL_SHORTCUT_FAB_COLORS).toEqual({
      trigger: 'primary',
      notes: 'medium',
      manual: 'primary',
      websites: 'tertiary',
      videos: 'forest',
    });
  });

  it('uses only approved bright colors for filled action surfaces', () => {
    const approvedColors = new Set(APPROVED_BRIGHT_FILLED_ACTION_SURFACE_COLORS);
    const usedColors = [
      GLOBAL_CREATE_FAB_COLOR,
      ...Object.values(LIST_PAGE_FAB_COLORS),
      ...Object.values(DETAIL_SHORTCUT_FAB_COLORS),
    ];

    expect(usedColors.every((color) => approvedColors.has(color))).toBe(true);
  });
});
