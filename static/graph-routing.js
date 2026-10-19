// Pure geometry; consumes rectangles and labels, with no DOM/application-state dependency.
const ArgusRouting = (() => {
  function automaticBoundary(rect, toward) {
    const center = {
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2
    };
    let dx = toward.x - center.x,
      dy = toward.y - center.y;
    if (!dx && !dy) dx = 1;
    const factor = Math.min(
      dx ? rect.w / 2 / Math.abs(dx) : Infinity,
      dy ? rect.h / 2 / Math.abs(dy) : Infinity
    );
    let x = center.x + dx * factor,
      y = center.y + dy * factor;
    const horizontal = Math.abs(x - center.x) >= rect.w / 2 - 0.01;
    const inset = Math.min(12, rect.w / 4, rect.h / 4);
    if (horizontal) y = Math.max(rect.y + inset, Math.min(rect.y + rect.h - inset, y));
    else x = Math.max(rect.x + inset, Math.min(rect.x + rect.w - inset, x));
    return {
      x,
      y,
      nx: horizontal ? Math.sign(dx) : 0,
      ny: horizontal ? 0 : Math.sign(dy)
    };
  }

  function connectionGeometry(a, b, sourcePort = null, targetPort = null) {
    const from = portPosition(a, sourcePort?.startsWith('right') ? sourcePort : 'right'),
      to = portPosition(b, targetPort?.startsWith('left') ? targetPort : 'left'),
      distance = to.x >= from.x ? (to.x - from.x) / 2 : 25 * Math.sqrt(from.x - to.x);
    const c1x = from.x + from.nx * distance,
      c1y = from.y + from.ny * distance,
      c2x = to.x + to.nx * distance,
      c2y = to.y + to.ny * distance;
    return {
      sx: from.x,
      sy: from.y,
      tx: to.x,
      ty: to.y,
      c1x,
      c1y,
      c2x,
      c2y,
      labelX: (from.x + 3 * c1x + 3 * c2x + to.x) / 8,
      labelY: (from.y + 3 * c1y + 3 * c2y + to.y) / 8
    };
  }

  function intersects(a, b, padding = 0) {
    return (
      a.x < b.x + b.w + padding &&
      a.x + a.w > b.x - padding &&
      a.y < b.y + b.h + padding &&
      a.y + a.h > b.y - padding
    );
  }

  function cubicPoint(points, t) {
    const u = 1 - t;
    return {
      x:
        u * u * u * points[0].x +
        3 * u * u * t * points[1].x +
        3 * u * t * t * points[2].x +
        t * t * t * points[3].x,
      y:
        u * u * u * points[0].y +
        3 * u * u * t * points[1].y +
        3 * u * t * t * points[2].y +
        t * t * t * points[3].y
    };
  }

  function splitCubic(points, t) {
    const lerp = (a, b) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
      }),
      a = lerp(points[0], points[1]),
      b = lerp(points[1], points[2]),
      c = lerp(points[2], points[3]),
      d = lerp(a, b),
      e = lerp(b, c),
      f = lerp(d, e);
    return [
      [points[0], a, d, f],
      [f, e, c, points[3]]
    ];
  }

  function cubicSlice(points, start, end) {
    const left = splitCubic(points, end)[0];
    return start ? splitCubic(left, start / end)[1] : left;
  }

  function curvePath(segments) {
    if (!segments.length) return '';
    let path = `M ${segments[0][0].x} ${segments[0][0].y}`;
    for (const segment of segments)
      path += ` C ${segment[1].x} ${segment[1].y}, ${segment[2].x} ${segment[2].y}, ${segment[3].x} ${segment[3].y}`;
    return path;
  }

  function curveLabelGap(segments, width, height = 28, labelPoint = null) {
    const table = [
        {
          length: 0,
          segment: 0,
          t: 0
        }
      ],
      starts = [];
    let length = 0,
      anchor = 0;
    for (const [index, segment] of segments.entries()) {
      starts.push(length);
      let previous = segment[0];
      for (let step = 1; step <= 64; step++) {
        const t = step / 64,
          p = cubicPoint(segment, t);
        length += Math.hypot(p.x - previous.x, p.y - previous.y);
        table.push({
          length,
          segment: index,
          t
        });
        previous = p;
        if (segments.length === 1 && step === 32) anchor = length;
      }
      if (segments.length === 2 && index === 0) anchor = length;
    }
    if (labelPoint) {
      let nearest = Infinity;
      for (const entry of table) {
        const p = cubicPoint(segments[entry.segment], entry.t),
          distance = Math.hypot(p.x - labelPoint.x, p.y - labelPoint.y);
        if (distance < nearest) {
          nearest = distance;
          anchor = entry.length;
        }
      }
    }
    const anchorPoint =
        labelPoint || (segments.length === 2 ? segments[0][3] : cubicPoint(segments[0], 0.5)),
      inside = (p) =>
        Math.abs(p.x - anchorPoint.x) <= width / 2 && Math.abs(p.y - anchorPoint.y) <= height / 2;
    let leftExtent = 0,
      rightExtent = 0;
    for (const entry of [...table].reverse()) {
      if (entry.length > anchor) continue;
      leftExtent = anchor - entry.length;
      if (!inside(cubicPoint(segments[entry.segment], entry.t))) break;
    }
    for (const entry of table) {
      if (entry.length < anchor) continue;
      rightExtent = entry.length - anchor;
      if (!inside(cubicPoint(segments[entry.segment], entry.t))) break;
    }
    const half = Math.max(
        0,
        Math.min(Math.max(leftExtent, rightExtent) + 2, anchor - 10, length - anchor - 10)
      ),
      left = anchor - half,
      right = anchor + half;
    const parameter = (distance) => {
      const index = table.findIndex((p) => p.length >= distance);
      if (index <= 0)
        return {
          segment: 0,
          t: 0
        };
      const a = table[index - 1],
        b = table[index],
        start = a.segment === b.segment ? a.t : 0,
        portion = (distance - a.length) / (b.length - a.length || 1);
      return {
        segment: b.segment,
        t: start + (b.t - start) * portion
      };
    };

    function between(begin, end) {
      if (end <= begin) return [];
      const a = parameter(begin),
        b = parameter(end),
        out = [];
      for (let index = a.segment; index <= b.segment; index++) {
        const from = index === a.segment ? a.t : 0,
          to = index === b.segment ? b.t : 1;
        if (to > from) out.push(cubicSlice(segments[index], from, to));
      }
      return out;
    }
    return {
      before: curvePath(between(0, left)),
      after: curvePath(between(right, length)),
      anchor,
      half,
      total: length
    };
  }

  // Straight runs joined by short rounded bends; all segments stay cubic so
  // hit testing and the existing label/action gap share exactly the same path.
  function roundedRoute(points, radius = 16) {
    const clean = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    const segments = [];
    const line = (a, b) => {
      if (a.x !== b.x || a.y !== b.y) segments.push([a, a, b, b]);
    };
    let previous = clean[0];
    for (let i = 1; i < clean.length - 1; i++) {
      const a = clean[i - 1],
        b = clean[i],
        c = clean[i + 1];
      const before = Math.hypot(b.x - a.x, b.y - a.y),
        after = Math.hypot(c.x - b.x, c.y - b.y);
      const r = Math.min(radius, before / 2, after / 2);
      const entry = { x: b.x + ((a.x - b.x) * r) / before, y: b.y + ((a.y - b.y) * r) / before };
      const exit = { x: b.x + ((c.x - b.x) * r) / after, y: b.y + ((c.y - b.y) * r) / after };
      line(previous, entry);
      segments.push([
        entry,
        { x: entry.x + ((b.x - entry.x) * 2) / 3, y: entry.y + ((b.y - entry.y) * 2) / 3 },
        { x: exit.x + ((b.x - exit.x) * 2) / 3, y: exit.y + ((b.y - exit.y) * 2) / 3 },
        exit
      ]);
      previous = exit;
    }
    line(previous, clean.at(-1));
    return segments;
  }

  function routeConnection(a, b, label, obstacles, labels, edge = {}, measuredWidth = null) {
    const from = portPosition(a, edge.source_port || 'right'),
      to = portPosition(b, edge.target_port || 'left'),
      width = Math.max(0, measuredWidth ?? label.length * 7) + 66,
      height = 28,
      backwards = from.x - 20 > to.x,
      middle = (from.x + to.x) / 2;
    const base = {
      x: middle,
      y: backwards ? from.y + 130 : (from.y + to.y) / 2
    };
    const clear = (p) => {
      const box = { x: p.x - width / 2, y: p.y - height / 2, w: width, h: height };
      return (
        !obstacles.some((r) => intersects(box, r, 8)) && !labels.some((r) => intersects(box, r, 8))
      );
    };
    // Geometry follows n8n: forward Bezier, backward rounded detour. Label
    // collision handling chooses a point ON that path instead of bending it.
    const geometry = connectionGeometry(a, b, edge.source_port, edge.target_port);
    const segments = backwards
      ? roundedRoute([
          from,
          { x: from.x + 40, y: from.y },
          { x: from.x + 40, y: base.y },
          { x: to.x - 40, y: base.y },
          { x: to.x - 40, y: to.y },
          to
        ])
      : [[from, { x: geometry.c1x, y: geometry.c1y }, { x: geometry.c2x, y: geometry.c2y }, to]];
    let point = base;
    if (!clear(point)) {
      const candidates = segments.flatMap((segment) =>
        [0.25, 0.5, 0.75].map((t) => cubicPoint(segment, t))
      );
      candidates.sort(
        (p, q) => Math.hypot(p.x - base.x, p.y - base.y) - Math.hypot(q.x - base.x, q.y - base.y)
      );
      point = candidates.find(clear) || base;
    }
    labels.push({ x: point.x - width / 2, y: point.y - height / 2, w: width, h: height });
    if (edge.label_clipping === 'mask') {
      const points = segments.flat();
      const minX = Math.min(...points.map((p) => p.x), point.x - width / 2) - 40;
      const minY = Math.min(...points.map((p) => p.y), point.y - height / 2) - 40;
      return {
        path: curvePath(segments),
        labelX: point.x,
        labelY: point.y,
        maskBounds: {
          x: minX,
          y: minY,
          w: Math.max(...points.map((p) => p.x), point.x + width / 2 + 70) - minX + 40,
          h: Math.max(...points.map((p) => p.y), point.y + height / 2) - minY + 40
        }
      };
    }
    const gap = curveLabelGap(
      segments,
      Math.max(0, measuredWidth ?? label.length * 7) + 16,
      height,
      point
    );
    const controlGap = curveLabelGap(
      segments,
      Math.max(0, measuredWidth ?? label.length * 7) + 72,
      height,
      { x: point.x + 28, y: point.y }
    );
    return {
      controlPaths: [
        { path: gap.before, arrow: false },
        { path: controlGap.after, arrow: true }
      ],
      path: curvePath(segments),
      labelX: point.x,
      labelY: point.y,
      visiblePaths: [
        { path: gap.before, arrow: false },
        { path: gap.after, arrow: true }
      ],
      gap
    };
  }

  function portPosition(rect, side) {
    const points = {
      left: {
        x: rect.x,
        y: rect.y + rect.h / 2,
        nx: -1,
        ny: 0
      },
      right: {
        x: rect.x + rect.w,
        y: rect.y + rect.h / 2,
        nx: 1,
        ny: 0
      },
      top: {
        x: rect.x + rect.w / 2,
        y: rect.y,
        nx: 0,
        ny: -1
      },
      bottom: {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h,
        nx: 0,
        ny: 1
      }
    };
    const [name, index, count] = String(side || 'right').split(':');
    const position = points[name] || points.right;
    if (count && (name === 'left' || name === 'right'))
      position.y = rect.y + (rect.h * (Number(index) + 1)) / (Number(count) + 1);
    return position;
  }
  return Object.freeze({
    automaticBoundary,
    connectionGeometry,
    intersects,
    cubicPoint,
    splitCubic,
    cubicSlice,
    curvePath,
    curveLabelGap,
    routeConnection,
    portPosition,
    roundedRoute
  });
})();

export default ArgusRouting;
