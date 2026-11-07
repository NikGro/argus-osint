/**
 * Node frame outline: a rounded rectangle with one rounded hump per connector port.
 * The hump is part of the same stroke, so the dock circle sits inside the frame.
 */
export const PORT_HUMP_DEPTH = 14;
export const PORT_DOCK_OFFSET = 7;
const HUMP_SPAN = 26;

/** Half-span per hump: as wide as possible without touching corners or the next hump. */
function spans(ys, h, r) {
  const sorted = [...ys].sort((a, b) => a - b);
  return sorted.map((y, i) => {
    const before = i ? (y - sorted[i - 1]) / 2 : y - r,
      after = i < sorted.length - 1 ? (sorted[i + 1] - y) / 2 : h - r - y;
    return [y, Math.min(HUMP_SPAN, before, after)];
  });
}

/**
 * Path for a w×h node with radius r, input humps at leftYs and output humps at rightYs.
 * Each hump is a bell curve: it leaves the edge tangentially, so it grows out of the
 * frame without a visible corner, and has a rounded crest that holds the socket.
 */
export function nodeOutline(w, h, r, leftYs = [], rightYs = []) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const d = PORT_HUMP_DEPTH,
    f = (n) => Math.round(n * 100) / 100;
  const usable = ([, s]) => s >= 8;
  const right = spans(rightYs, h, r).filter(usable),
    left = spans(leftYs, h, r).filter(usable).reverse();
  let p = `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}`;
  for (const [y, s] of right)
    p +=
      `V${f(y - s)}C${f(w)} ${f(y - s * 0.5)} ${f(w + d)} ${f(y - s * 0.45)} ${f(w + d)} ${f(y)}` +
      `C${f(w + d)} ${f(y + s * 0.45)} ${f(w)} ${f(y + s * 0.5)} ${f(w)} ${f(y + s)}`;
  p += `V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}`;
  for (const [y, s] of left)
    p +=
      `V${f(y + s)}C0 ${f(y + s * 0.5)} ${f(-d)} ${f(y + s * 0.45)} ${f(-d)} ${f(y)}` +
      `C${f(-d)} ${f(y - s * 0.45)} 0 ${f(y - s * 0.5)} 0 ${f(y - s)}`;
  return p + `V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
}

/** Node rect widened by the humps, so connections end on the outside of a hump. */
export function socketRect(rect) {
  return { ...rect, x: rect.x - PORT_HUMP_DEPTH, w: rect.w + 2 * PORT_HUMP_DEPTH };
}
