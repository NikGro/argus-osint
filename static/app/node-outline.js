/**
 * Node frame outline: a rounded rectangle with one rounded hump per connector port.
 * The hump is part of the same stroke, so the dock circle sits inside the frame.
 */
export const PORT_HUMP_DEPTH = 10;
export const PORT_DOCK_OFFSET = 4;
const HUMP_HALF = 13;

function humpHalf(ports, h) {
  const ys = [...ports].sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < ys.length; i++) gap = Math.min(gap, ys[i] - ys[i - 1]);
  return Math.max(5, Math.min(HUMP_HALF, gap / 2 - 2, h / 2 - 4));
}

/** Path for a w×h node with radius r, input humps at leftYs and output humps at rightYs. */
export function nodeOutline(w, h, r, leftYs = [], rightYs = []) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const d = PORT_HUMP_DEPTH,
    f = (n) => Math.round(n * 100) / 100;
  const keep = (ys) => ys.filter((y) => y - HUMP_HALF >= r - 2 && y + HUMP_HALF <= h - r + 2);
  const right = keep(rightYs).sort((a, b) => a - b),
    left = keep(leftYs).sort((a, b) => b - a);
  const ra = humpHalf(right, h),
    la = humpHalf(left, h);
  let p = `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}`;
  for (const y of right)
    p +=
      `V${f(y - ra)}C${f(w)} ${f(y - ra * 0.45)} ${f(w + d)} ${f(y - ra * 0.7)} ${f(w + d)} ${f(y)}` +
      `C${f(w + d)} ${f(y + ra * 0.7)} ${f(w)} ${f(y + ra * 0.45)} ${f(w)} ${f(y + ra)}`;
  p += `V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}`;
  for (const y of left)
    p +=
      `V${f(y + la)}C0 ${f(y + la * 0.45)} ${f(-d)} ${f(y + la * 0.7)} ${f(-d)} ${f(y)}` +
      `C${f(-d)} ${f(y - la * 0.7)} 0 ${f(y - la * 0.45)} 0 ${f(y - la)}`;
  return p + `V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
}
