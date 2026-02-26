export type LayoutMode = 'mobile' | 'desktop';

export const DESKTOP_LAYOUT_MIN_WIDTH_PX = 1024;
export const DESKTOP_LAYOUT_MEDIA_QUERY = `(min-width: ${String(DESKTOP_LAYOUT_MIN_WIDTH_PX)}px)`;
