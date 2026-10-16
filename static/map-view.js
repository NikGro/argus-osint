/** Cached map tiles are fetched only from Argus, never directly from a provider. */
const latitude = Number(document.body.dataset.lat),
  longitude = Number(document.body.dataset.lon);
let zoom = 14,
  offsetX = 0,
  offsetY = 0,
  drag = null;
function draw() {
  const count = 2 ** zoom,
    rad = (latitude * Math.PI) / 180;
  const cx = ((longitude + 180) / 360) * count,
    cy = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * count;
  const centerX = cx - offsetX / 256,
    centerY = cy - offsetY / 256;
  const tiles = document.getElementById('tiles');
  tiles.replaceChildren();
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const x = Math.floor(centerX) + dx,
        y = Math.floor(centerY) + dy;
      if (y < 0 || y >= count) continue;
      const image = document.createElement('img');
      image.draggable = false;
      image.alt = '';
      image.src =
        '/api/map-tile?' + new URLSearchParams({ z: zoom, x: ((x % count) + count) % count, y });
      image.style.left = `calc(50% + ${(x - centerX) * 256}px)`;
      image.style.top = `calc(50% + ${(y - centerY) * 256}px)`;
      tiles.append(image);
    }
  const marker = document.getElementById('marker');
  marker.style.left = `calc(50% + ${offsetX}px)`;
  marker.style.top = `calc(50% + ${offsetY}px)`;
}
for (const [id, delta] of [
  ['in', 1],
  ['out', -1]
])
  document.getElementById(id).addEventListener('click', () => {
    zoom = Math.min(19, Math.max(1, zoom + delta));
    offsetX = offsetY = 0;
    draw();
  });
document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button,a')) return;
  drag = { x: event.clientX, y: event.clientY, ox: offsetX, oy: offsetY };
  document.body.setPointerCapture(event.pointerId);
});
document.addEventListener('pointerup', (event) => {
  if (!drag) return;
  offsetX = drag.ox + event.clientX - drag.x;
  offsetY = drag.oy + event.clientY - drag.y;
  drag = null;
  draw();
});
draw();
