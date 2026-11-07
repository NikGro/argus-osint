/**
 * Canvas zoom scale. The toolbar shows zoom relative to ZOOM_BASE, so "100 %" is a
 * comfortable working size with room for more nodes than the raw SVG scale of 1.
 */
export const ZOOM_BASE = 0.7;
export const ZOOM_MIN_PERCENT = 15;
export const ZOOM_MAX_PERCENT = 300;
export const MIN_SCALE = (ZOOM_MIN_PERCENT / 100) * ZOOM_BASE;
export const MAX_SCALE = (ZOOM_MAX_PERCENT / 100) * ZOOM_BASE;

export const clampScale = (scale) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
export const scaleToPercent = (scale) => (scale / ZOOM_BASE) * 100;
export const percentToScale = (percent) => (percent / 100) * ZOOM_BASE;
