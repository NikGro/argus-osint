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
    const ac = {
        x: a.x + a.w / 2,
        y: a.y + a.h / 2
      },
      bc = {
        x: b.x + b.w / 2,
        y: b.y + b.h / 2
      };
    const from = sourcePort ? portPosition(a, sourcePort) : automaticBoundary(a, bc),
      to = targetPort ? portPosition(b, targetPort) : automaticBoundary(b, ac),
      distance = Math.min(180, Math.max(35, Math.hypot(to.x - from.x, to.y - from.y) * 0.42));
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

  function curveLabelGap(segments, width, height = 28) {
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
    const anchorPoint = segments.length === 2 ? segments[0][3] : cubicPoint(segments[0], 0.5),
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

  function routeConnection(a, b, label, obstacles, labels, edge = {}, measuredWidth = null) {
    const g = connectionGeometry(a, b),
      width = Math.max(0, measuredWidth ?? label.length * 7) + 66,
      height = 28,
      base = {
        x: g.labelX,
        y: g.labelY
      };
    const clear = (p) => {
      const box = {
        x: p.x - width / 2,
        y: p.y - height / 2,
        w: width,
        h: height
      };
      return (
        !obstacles.some((r) => intersects(box, r, 8)) && !labels.some((r) => intersects(box, r, 8))
      );
    };
    let point = base,
      segments = [
        [
          {
            x: g.sx,
            y: g.sy
          },
          {
            x: g.c1x,
            y: g.c1y
          },
          {
            x: g.c2x,
            y: g.c2y
          },
          {
            x: g.tx,
            y: g.ty
          }
        ]
      ];
    if (!clear(point)) {
      let found = false;
      for (let radius = 32; radius <= 640 && !found; radius += 32) {
        for (const [dx, dy] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
          [-0.707, -0.707],
          [0.707, -0.707],
          [-0.707, 0.707],
          [0.707, 0.707]
        ]) {
          const candidate = {
            x: base.x + dx * radius,
            y: base.y + dy * radius
          };
          if (clear(candidate)) {
            point = candidate;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        const top =
          Math.min(a.y, b.y, ...obstacles.map((r) => r.y), ...labels.map((r) => r.y)) - height - 20;
        for (let i = 0; i <= labels.length + 1; i++) {
          const candidate = {
            x: base.x + i * (width + 20),
            y: top
          };
          if (clear(candidate)) {
            point = candidate;
            found = true;
            break;
          }
        }
      }
      const from = automaticBoundary(a, point),
        to = automaticBoundary(b, point),
        dx = to.x - from.x,
        dy = to.y - from.y,
        distance = Math.hypot(dx, dy) || 1,
        tangent = {
          x: dx / distance,
          y: dy / distance
        },
        first = Math.hypot(point.x - from.x, point.y - from.y),
        second = Math.hypot(point.x - to.x, point.y - to.y),
        midHandle = Math.max(16, Math.min(180, first * 0.35, second * 0.35)),
        lead = Math.max(25, Math.min(200, first * 0.45)),
        tail = Math.max(25, Math.min(200, second * 0.45));
      segments = [
        [
          from,
          {
            x: from.x + from.nx * lead,
            y: from.y + from.ny * lead
          },
          {
            x: point.x - tangent.x * midHandle,
            y: point.y - tangent.y * midHandle
          },
          point
        ],
        [
          point,
          {
            x: point.x + tangent.x * midHandle,
            y: point.y + tangent.y * midHandle
          },
          {
            x: to.x + to.nx * tail,
            y: to.y + to.ny * tail
          },
          to
        ]
      ];
    }
    labels.push({
      x: point.x - width / 2,
      y: point.y - height / 2,
      w: width,
      h: height
    });
    const path = curvePath(segments),
      gap = curveLabelGap(segments, Math.max(0, measuredWidth ?? label.length * 7) + 16);
    return {
      path,
      labelX: point.x,
      labelY: point.y,
      visiblePaths: [
        {
          path: gap.before,
          arrow: false
        },
        {
          path: gap.after,
          arrow: true
        }
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
    return points[side] || points.right;
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
    portPosition
  });
})();

export default ArgusRouting;
