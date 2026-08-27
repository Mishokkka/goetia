const TAU = Math.PI * 2;

export const UNLOCK_SIGIL_VERSION = 8;

export function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function line(from, to) {
  return [{ ...from }, { ...to }];
}

function polyline(...points) {
  return points.map((point) => ({ ...point }));
}

function quadratic(from, control, to, steps = 18) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const mt = 1 - t;
    return {
      x: mt * mt * from.x + 2 * mt * t * control.x + t * t * to.x,
      y: mt * mt * from.y + 2 * mt * t * control.y + t * t * to.y
    };
  });
}

function cubic(from, firstControl, secondControl, to, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const mt = 1 - t;
    return {
      x: mt ** 3 * from.x + 3 * mt * mt * t * firstControl.x + 3 * mt * t * t * secondControl.x + t ** 3 * to.x,
      y: mt ** 3 * from.y + 3 * mt * mt * t * firstControl.y + 3 * mt * t * t * secondControl.y + t ** 3 * to.y
    };
  });
}

function arc(cx, cy, rx, ry, start, end, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + ((end - start) * index) / steps;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

function circle(cx, cy, radius, steps = 28) {
  return arc(cx, cy, radius, radius, 0, TAU, steps);
}

function cross(cx, cy, size) {
  return [
    line({ x: cx - size, y: cy }, { x: cx + size, y: cy }),
    line({ x: cx, y: cy - size }, { x: cx, y: cy + size })
  ];
}

function diamond(cx, cy, width, height) {
  return [polyline(
    { x: cx, y: cy - height },
    { x: cx + width, y: cy },
    { x: cx, y: cy + height },
    { x: cx - width, y: cy },
    { x: cx, y: cy - height }
  )];
}

function triangle(cx, cy, width, height, inverted = false) {
  const direction = inverted ? -1 : 1;
  return [polyline(
    { x: cx, y: cy - direction * height },
    { x: cx + width, y: cy + direction * height },
    { x: cx - width, y: cy + direction * height },
    { x: cx, y: cy - direction * height }
  )];
}

function eye(cx, cy, width, height) {
  return [
    quadratic({ x: cx - width, y: cy }, { x: cx, y: cy - height }, { x: cx + width, y: cy }),
    quadratic({ x: cx - width, y: cy }, { x: cx, y: cy + height }, { x: cx + width, y: cy }),
    circle(cx, cy, Math.min(width, height) * 0.34, 18)
  ];
}

function hourglass(cx, cy, width, height) {
  return [polyline(
    { x: cx - width, y: cy - height },
    { x: cx + width, y: cy - height },
    { x: cx - width, y: cy + height },
    { x: cx + width, y: cy + height }
  )];
}

function brokenHalo(cx, cy, radius, gap = 0.42) {
  return [
    arc(cx, cy, radius, radius * 0.74, gap, Math.PI - gap, 18),
    arc(cx, cy, radius, radius * 0.74, Math.PI + gap, TAU - gap, 18)
  ];
}

function trident(cx, top, width, height) {
  return [
    line({ x: cx, y: top + height }, { x: cx, y: top }),
    quadratic({ x: cx, y: top + height * 0.48 }, { x: cx - width * 0.65, y: top + height * 0.42 }, { x: cx - width, y: top + height * 0.08 }),
    quadratic({ x: cx, y: top + height * 0.48 }, { x: cx + width * 0.65, y: top + height * 0.42 }, { x: cx + width, y: top + height * 0.08 })
  ];
}

function sideHook(cx, cy, side, reach = 0.19, lift = 0.08) {
  const direction = side < 0 ? -1 : 1;
  return cubic(
    { x: cx, y: cy },
    { x: cx + direction * reach * 0.38, y: cy - lift },
    { x: cx + direction * reach, y: cy - lift * 0.2 },
    { x: cx + direction * reach * 0.8, y: cy + lift * 0.72 }
  );
}

function inwardCurl(cx, cy, side, reach = 0.18, height = 0.12) {
  const direction = side < 0 ? -1 : 1;
  return cubic(
    { x: cx, y: cy },
    { x: cx + direction * reach, y: cy - height },
    { x: cx + direction * reach, y: cy + height },
    { x: cx + direction * reach * 0.38, y: cy + height * 0.58 }
  );
}

function crescent(cx, cy, width, height, side = 1) {
  const direction = side < 0 ? -1 : 1;
  const first = arc(cx, cy, width, height, -Math.PI * 0.72, Math.PI * 0.72, 20);
  const second = arc(cx + direction * width * 0.45, cy, width * 0.63, height * 0.76, Math.PI * 0.7, -Math.PI * 0.7, 16);
  return [first, second];
}


function spiral(cx, cy, radius = 0.1, turns = 1.35, side = 1, steps = 30) {
  const direction = side < 0 ? -1 : 1;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const angle = direction * turns * TAU * t;
    const current = radius * (1 - t * 0.78);
    return { x: cx + Math.cos(angle) * current, y: cy + Math.sin(angle) * current };
  });
}

function ladder(cx, top, width, height, rungs = 3) {
  const strokes = [
    line({ x: cx - width, y: top }, { x: cx - width * 0.86, y: top + height }),
    line({ x: cx + width, y: top }, { x: cx + width * 0.86, y: top + height })
  ];
  for (let index = 1; index <= rungs; index += 1) {
    const t = index / (rungs + 1);
    const y = top + height * t;
    strokes.push(line({ x: cx - width * (1 - t * 0.14), y }, { x: cx + width * (1 - t * 0.14), y: y + 0.006 * (index % 2 ? 1 : -1) }));
  }
  return strokes;
}

function fork(cx, cy, width, height, downward = false) {
  const direction = downward ? 1 : -1;
  return [
    line({ x: cx, y: cy }, { x: cx, y: cy + direction * height }),
    line({ x: cx, y: cy + direction * height * 0.55 }, { x: cx - width, y: cy + direction * height }),
    line({ x: cx, y: cy + direction * height * 0.55 }, { x: cx + width, y: cy + direction * height })
  ];
}

function addEndRing(strokes, point, radius = 0.018) {
  strokes.push(circle(point.x, point.y, radius, 18));
}

function pushAll(target, strokes) {
  for (const stroke of strokes) target.push(stroke);
}

function createMainFrame(random, type, cx, mirror) {
  const strokes = [];
  const lean = (random() - 0.5) * 0.055;
  const left = cx - 0.22;
  const right = cx + 0.22;
  const top = 0.18;
  const bottom = 0.81;

  switch (type) {
    case 0: {
      strokes.push(line({ x: cx + lean, y: top }, { x: cx - lean * 0.4, y: bottom }));
      strokes.push(line({ x: left + 0.03, y: 0.42 }, { x: right, y: 0.42 + lean }));
      strokes.push(quadratic({ x: left + 0.04, y: 0.42 }, { x: left - 0.04, y: 0.5 }, { x: left + 0.02, y: 0.57 }));
      break;
    }
    case 1: {
      strokes.push(quadratic({ x: left, y: 0.31 }, { x: cx, y: 0.12 }, { x: right, y: 0.29 }));
      strokes.push(line({ x: left, y: 0.31 }, { x: left + 0.03, y: 0.72 }));
      strokes.push(line({ x: right, y: 0.29 }, { x: right - 0.02, y: 0.66 }));
      strokes.push(line({ x: cx + lean, y: 0.25 }, { x: cx - lean, y: bottom }));
      break;
    }
    case 2: {
      strokes.push(cubic({ x: left, y: 0.28 }, { x: left - 0.02, y: 0.58 }, { x: cx - 0.1, y: 0.76 }, { x: cx, y: bottom }));
      strokes.push(cubic({ x: right, y: 0.24 }, { x: right + 0.01, y: 0.56 }, { x: cx + 0.11, y: 0.74 }, { x: cx, y: bottom }));
      strokes.push(line({ x: left - 0.02, y: 0.39 }, { x: right + 0.02, y: 0.39 }));
      break;
    }
    case 3: {
      strokes.push(polyline(
        { x: left, y: 0.29 },
        { x: cx - 0.09, y: 0.18 },
        { x: right, y: 0.28 },
        { x: right - 0.02, y: 0.61 },
        { x: cx, y: bottom },
        { x: left + 0.02, y: 0.62 },
        { x: left, y: 0.29 }
      ));
      strokes.push(line({ x: cx + lean, y: 0.2 }, { x: cx - lean, y: 0.73 }));
      break;
    }
    case 4: {
      const direction = mirror ? -1 : 1;
      strokes.push(line({ x: cx - direction * 0.18, y: top }, { x: cx + direction * 0.18, y: bottom }));
      strokes.push(line({ x: left, y: 0.46 }, { x: right, y: 0.42 }));
      strokes.push(sideHook(cx + direction * 0.04, 0.63, -direction, 0.2, 0.11));
      break;
    }
    case 5: {
      strokes.push(line({ x: left + 0.05, y: 0.23 }, { x: left + 0.05, y: 0.72 }));
      strokes.push(line({ x: right - 0.02, y: 0.2 }, { x: right - 0.02, y: 0.75 }));
      strokes.push(quadratic({ x: left + 0.05, y: 0.23 }, { x: cx, y: 0.11 }, { x: right - 0.02, y: 0.2 }));
      strokes.push(line({ x: left + 0.05, y: 0.48 }, { x: right - 0.02, y: 0.48 }));
      break;
    }
    case 6: {
      pushAll(strokes, ladder(cx, 0.22, 0.17, 0.48, 3));
      strokes.push(line({ x: cx, y: 0.16 }, { x: cx, y: bottom }));
      break;
    }
    case 7: {
      strokes.push(polyline({ x: left, y: 0.3 }, { x: cx - 0.08, y: 0.2 }, { x: cx, y: 0.38 }, { x: cx + 0.1, y: 0.2 }, { x: right, y: 0.31 }));
      strokes.push(line({ x: cx, y: 0.38 }, { x: cx, y: bottom }));
      strokes.push(quadratic({ x: left + 0.04, y: 0.58 }, { x: cx, y: 0.71 }, { x: right - 0.03, y: 0.58 }));
      break;
    }
    case 8: {
      strokes.push(cubic({ x: left, y: 0.23 }, { x: cx - 0.01, y: 0.23 }, { x: cx - 0.01, y: 0.46 }, { x: right, y: 0.46 }));
      strokes.push(cubic({ x: right, y: 0.46 }, { x: cx, y: 0.46 }, { x: cx, y: 0.71 }, { x: left + 0.04, y: 0.72 }));
      strokes.push(line({ x: cx, y: top }, { x: cx, y: bottom }));
      break;
    }
    case 9: {
      strokes.push(arc(cx, 0.47, 0.23, 0.31, -Math.PI * 0.92, Math.PI * 0.92, 30));
      strokes.push(line({ x: cx - 0.19, y: 0.46 }, { x: cx + 0.18, y: 0.46 }));
      strokes.push(line({ x: cx, y: 0.18 }, { x: cx, y: 0.79 }));
      break;
    }
    case 10: {
      pushAll(strokes, hourglass(cx, 0.49, 0.2, 0.29));
      strokes.push(line({ x: cx, y: 0.18 }, { x: cx, y: 0.8 }));
      break;
    }
    case 11: {
      pushAll(strokes, eye(cx, 0.43, 0.23, 0.14));
      strokes.push(line({ x: cx, y: 0.16 }, { x: cx, y: 0.81 }));
      break;
    }
    case 12: {
      pushAll(strokes, brokenHalo(cx, 0.46, 0.24, 0.52));
      strokes.push(polyline({ x: cx - 0.15, y: 0.22 }, { x: cx + 0.12, y: 0.48 }, { x: cx - 0.1, y: 0.78 }));
      break;
    }
    case 13: {
      pushAll(strokes, triangle(cx, 0.46, 0.22, 0.29, false));
      strokes.push(line({ x: cx, y: 0.18 }, { x: cx, y: 0.79 }));
      break;
    }
    case 14: {
      strokes.push(spiral(cx, 0.47, 0.23, 1.5, mirror ? -1 : 1, 42));
      strokes.push(line({ x: left + 0.02, y: 0.31 }, { x: right - 0.02, y: 0.67 }));
      break;
    }
    default: {
      strokes.push(cubic({ x: cx - 0.02, y: top }, { x: cx + 0.22, y: 0.3 }, { x: cx - 0.22, y: 0.56 }, { x: cx + 0.02, y: bottom }));
      strokes.push(line({ x: left + 0.02, y: 0.43 }, { x: right, y: 0.45 }));
      strokes.push(line({ x: cx - 0.14, y: 0.62 }, { x: cx + 0.14, y: 0.62 }));
      break;
    }
  }

  return strokes;
}

function addCrown(strokes, random, cx, rank) {
  const crownType = Math.floor(random() * 14);
  const y = 0.18 + random() * 0.035;
  switch (crownType) {
    case 0:
      pushAll(strokes, trident(cx, 0.08, 0.13, 0.16));
      break;
    case 1:
      strokes.push(circle(cx, y - 0.045, 0.038));
      strokes.push(line({ x: cx - 0.15, y }, { x: cx + 0.15, y }));
      break;
    case 2:
      strokes.push(quadratic({ x: cx - 0.17, y }, { x: cx, y: 0.055 }, { x: cx + 0.17, y }));
      addEndRing(strokes, { x: cx - 0.17, y });
      addEndRing(strokes, { x: cx + 0.17, y });
      break;
    case 3:
      strokes.push(polyline({ x: cx - 0.14, y }, { x: cx - 0.07, y: 0.1 }, { x: cx, y }, { x: cx + 0.07, y: 0.1 }, { x: cx + 0.14, y }));
      break;
    case 4:
      pushAll(strokes, crescent(cx, y - 0.015, 0.12, 0.07, random() < 0.5 ? -1 : 1));
      break;
    case 5:
      strokes.push(line({ x: cx - 0.16, y }, { x: cx + 0.16, y }));
      addEndRing(strokes, { x: cx - 0.16, y }, 0.022);
      addEndRing(strokes, { x: cx + 0.16, y }, 0.022);
      if (rank >= 3) strokes.push(circle(cx, y, 0.025));
      break;
    case 6:
      pushAll(strokes, fork(cx, y + 0.02, 0.09, 0.12, false));
      addEndRing(strokes, { x: cx - 0.09, y: y - 0.1 }, 0.017);
      addEndRing(strokes, { x: cx + 0.09, y: y - 0.1 }, 0.017);
      break;
    case 7:
      strokes.push(spiral(cx, y - 0.015, 0.09, 1.15, random() < 0.5 ? -1 : 1));
      strokes.push(line({ x: cx - 0.14, y: y + 0.025 }, { x: cx + 0.14, y: y + 0.025 }));
      break;
    case 8:
      strokes.push(polyline({ x: cx - 0.16, y }, { x: cx - 0.1, y: 0.085 }, { x: cx - 0.02, y }, { x: cx + 0.07, y: 0.075 }, { x: cx + 0.16, y }));
      addEndRing(strokes, { x: cx - 0.16, y }, 0.017);
      addEndRing(strokes, { x: cx + 0.16, y }, 0.017);
      break;
    case 9:
      pushAll(strokes, eye(cx, y - 0.045, 0.13, 0.055));
      break;
    case 10:
      pushAll(strokes, brokenHalo(cx, y - 0.035, 0.13, 0.48));
      strokes.push(line({ x: cx, y: y - 0.12 }, { x: cx, y: y + 0.025 }));
      break;
    case 11:
      pushAll(strokes, triangle(cx, y - 0.025, 0.095, 0.075, true));
      addEndRing(strokes, { x: cx, y: y - 0.1 }, 0.016);
      break;
    case 12:
      strokes.push(hourglass(cx, y - 0.03, 0.09, 0.065)[0]);
      strokes.push(line({ x: cx - 0.15, y: y + 0.025 }, { x: cx + 0.15, y: y + 0.025 }));
      break;
    default:
      strokes.push(arc(cx, y - 0.015, 0.15, 0.075, Math.PI, TAU, 22));
      strokes.push(circle(cx, y - 0.08, 0.022));
      break;
  }
}

function addBase(strokes, random, cx, rank) {
  const baseType = Math.floor(random() * 13);
  const y = 0.8;
  switch (baseType) {
    case 0:
      strokes.push(line({ x: cx - 0.18, y }, { x: cx + 0.18, y }));
      addEndRing(strokes, { x: cx - 0.18, y });
      addEndRing(strokes, { x: cx + 0.18, y });
      break;
    case 1:
      pushAll(strokes, diamond(cx, y, 0.075, 0.09));
      break;
    case 2:
      strokes.push(quadratic({ x: cx - 0.18, y: y - 0.04 }, { x: cx, y: 0.93 }, { x: cx + 0.18, y: y - 0.04 }));
      break;
    case 3:
      strokes.push(line({ x: cx, y: y - 0.07 }, { x: cx, y: 0.91 }));
      strokes.push(line({ x: cx - 0.08, y: 0.88 }, { x: cx + 0.08, y: 0.88 }));
      break;
    case 4:
      strokes.push(inwardCurl(cx, y - 0.03, -1, 0.18, 0.11));
      strokes.push(inwardCurl(cx, y - 0.03, 1, 0.18, 0.11));
      break;
    case 5:
      strokes.push(line({ x: cx - 0.16, y: y - 0.02 }, { x: cx + 0.11, y: y + 0.04 }));
      strokes.push(circle(cx + 0.13, y + 0.045, 0.027));
      if (rank >= 4) strokes.push(line({ x: cx - 0.05, y: y - 0.09 }, { x: cx - 0.05, y: y + 0.08 }));
      break;
    case 6:
      pushAll(strokes, fork(cx, y - 0.04, 0.1, 0.13, true));
      break;
    case 7:
      strokes.push(spiral(cx, y, 0.1, 1.25, random() < 0.5 ? -1 : 1));
      break;
    case 8:
      pushAll(strokes, ladder(cx, y - 0.09, 0.12, 0.15, 2));
      break;
    case 9:
      pushAll(strokes, eye(cx, y, 0.13, 0.055));
      break;
    case 10:
      pushAll(strokes, triangle(cx, y, 0.1, 0.08, false));
      break;
    case 11:
      pushAll(strokes, brokenHalo(cx, y, 0.13, 0.55));
      break;
    default:
      pushAll(strokes, hourglass(cx, y, 0.1, 0.075));
      break;
  }
}

function addSideOrnament(strokes, random, cx, side, rank, yOverride = null) {
  const y = yOverride ?? (0.33 + random() * 0.31);
  const type = Math.floor(random() * 13);
  switch (type) {
    case 0:
      strokes.push(sideHook(cx, y, side, 0.17 + random() * 0.07, 0.07 + random() * 0.05));
      break;
    case 1:
      strokes.push(inwardCurl(cx, y, side, 0.16 + random() * 0.07, 0.1));
      break;
    case 2: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(line({ x: cx, y }, { x: cx + direction * 0.21, y: y + 0.015 }));
      addEndRing(strokes, { x: cx + direction * 0.21, y: y + 0.015 });
      break;
    }
    case 3: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(polyline(
        { x: cx, y },
        { x: cx + direction * 0.1, y: y - 0.06 },
        { x: cx + direction * 0.2, y: y + 0.025 }
      ));
      if (rank >= 4) addEndRing(strokes, { x: cx + direction * 0.2, y: y + 0.025 }, 0.018);
      break;
    }
    case 4: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(arc(cx + direction * 0.12, y, 0.1, 0.075, side < 0 ? -Math.PI * 0.65 : Math.PI * 0.35, side < 0 ? Math.PI * 0.65 : Math.PI * 1.65, 18));
      break;
    }
    case 5: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(spiral(cx + direction * 0.12, y, 0.09, 1.2, side));
      break;
    }
    case 6: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(line({ x: cx, y }, { x: cx + direction * 0.24, y: y - 0.05 }));
      pushAll(strokes, fork(cx + direction * 0.24, y - 0.05, 0.05, 0.08, side < 0));
      break;
    }
    case 7: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(polyline({ x: cx, y }, { x: cx + direction * 0.09, y: y - 0.08 }, { x: cx + direction * 0.16, y: y + 0.01 }, { x: cx + direction * 0.24, y: y - 0.06 }));
      addEndRing(strokes, { x: cx + direction * 0.24, y: y - 0.06 }, 0.018);
      break;
    }
    case 8: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(cubic({ x: cx, y }, { x: cx + direction * 0.08, y: y + 0.1 }, { x: cx + direction * 0.2, y: y - 0.1 }, { x: cx + direction * 0.25, y: y + 0.02 }));
      strokes.push(circle(cx + direction * 0.25, y + 0.02, 0.018));
      break;
    }
    case 9: {
      const direction = side < 0 ? -1 : 1;
      const center = cx + direction * 0.14;
      strokes.push(line({ x: cx, y }, { x: center - direction * 0.06, y }));
      pushAll(strokes, eye(center, y, 0.09, 0.045));
      break;
    }
    case 10: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(line({ x: cx, y }, { x: cx + direction * 0.11, y }));
      pushAll(strokes, triangle(cx + direction * 0.18, y, 0.065, 0.055, side < 0));
      break;
    }
    case 11: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(line({ x: cx, y }, { x: cx + direction * 0.11, y }));
      pushAll(strokes, brokenHalo(cx + direction * 0.18, y, 0.075, 0.62));
      break;
    }
    default: {
      const direction = side < 0 ? -1 : 1;
      strokes.push(line({ x: cx, y }, { x: cx + direction * 0.1, y }));
      pushAll(strokes, hourglass(cx + direction * 0.18, y, 0.065, 0.055));
      break;
    }
  }
}

function addInnerGlyph(strokes, random, cx, rank, yOverride = null) {
  const y = yOverride ?? (0.44 + random() * 0.18);
  const type = Math.floor(random() * 16);
  switch (type) {
    case 0:
      pushAll(strokes, cross(cx, y, 0.07 + rank * 0.004));
      break;
    case 1:
      strokes.push(circle(cx, y, 0.055 + rank * 0.003));
      break;
    case 2:
      pushAll(strokes, diamond(cx, y, 0.055, 0.07));
      break;
    case 3:
      strokes.push(line({ x: cx - 0.11, y: y - 0.035 }, { x: cx + 0.11, y: y - 0.035 }));
      strokes.push(line({ x: cx - 0.08, y: y + 0.04 }, { x: cx + 0.12, y: y + 0.04 }));
      break;
    case 4:
      pushAll(strokes, crescent(cx, y, 0.08, 0.055, random() < 0.5 ? -1 : 1));
      break;
    case 5:
      strokes.push(polyline({ x: cx - 0.07, y: y + 0.07 }, { x: cx, y: y - 0.07 }, { x: cx + 0.07, y: y + 0.07 }));
      break;
    case 6:
      strokes.push(circle(cx - 0.055, y, 0.025));
      strokes.push(circle(cx + 0.055, y, 0.025));
      strokes.push(line({ x: cx - 0.11, y: y + 0.07 }, { x: cx + 0.11, y: y + 0.07 }));
      break;
    case 7:
      strokes.push(spiral(cx, y, 0.075, 1.15, random() < 0.5 ? -1 : 1));
      break;
    case 8:
      pushAll(strokes, fork(cx, y + 0.04, 0.07, 0.12, false));
      break;
    case 9:
      pushAll(strokes, ladder(cx, y - 0.08, 0.08, 0.16, 2));
      break;
    case 10:
      strokes.push(arc(cx, y, 0.11, 0.065, Math.PI * 0.1, Math.PI * 1.9, 22));
      strokes.push(line({ x: cx - 0.1, y }, { x: cx + 0.1, y }));
      break;
    case 11:
      pushAll(strokes, eye(cx, y, 0.1, 0.05));
      break;
    case 12:
      pushAll(strokes, triangle(cx, y, 0.075, 0.07, random() < 0.5));
      break;
    case 13:
      pushAll(strokes, hourglass(cx, y, 0.075, 0.07));
      break;
    case 14:
      pushAll(strokes, brokenHalo(cx, y, 0.09, 0.58));
      addEndRing(strokes, { x: cx, y }, 0.018);
      break;
    default:
      strokes.push(polyline({ x: cx - 0.09, y: y - 0.07 }, { x: cx + 0.09, y: y + 0.07 }, { x: cx - 0.09, y: y + 0.07 }, { x: cx + 0.09, y: y - 0.07 }));
      break;
  }
}

export function createSpellSigil(seedValue, rank = 1, { personal = false } = {}) {
  const complexity = clamp(Number(rank) || 1, 1, 6);
  const elementCount = personal ? 2 : Math.min(6, complexity + 1);
  const seed = hashString(`${seedValue}:${personal ? "personal" : "spell"}`);
  const random = mulberry32(seed);
  const cx = 0.5 + (random() - 0.5) * 0.055;
  const mirror = random() < 0.5;
  const frameType = Math.floor(random() * 16);
  const elements = [createMainFrame(random, frameType, cx, mirror)];

  const distinctness = (candidate) => {
    const candidateCells = rasterCells(candidate, 72, 0);
    if (!candidateCells.size || !elements.length) return 1;
    const existingWide = rasterCells(elements.flat(), 72, 2);
    return 1 - overlapRatio(candidateCells, existingWide);
  };

  const addElement = (builder) => {
    if (elements.length >= elementCount) return;
    let best = null;
    let bestDistinctness = -1;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const element = [];
      builder(element);
      if (!element.length) continue;
      const score = distinctness(element);
      if (score > bestDistinctness) {
        best = element;
        bestDistinctness = score;
      }
      if (score >= 0.5) break;
    }
    if (best?.length) elements.push(best);
  };

  addElement((element) => addCrown(element, random, cx, complexity));
  addElement((element) => addBase(element, random, cx, complexity));

  const primarySide = mirror ? -1 : 1;
  addElement((element) => addSideOrnament(
    element,
    random,
    cx + (random() - 0.5) * 0.02,
    primarySide,
    complexity,
    0.42 + (random() - 0.5) * 0.04
  ));

  addElement((element) => addInnerGlyph(
    element,
    random,
    cx + (random() - 0.5) * 0.018,
    complexity,
    0.54 + (random() - 0.5) * 0.035
  ));

  addElement((element) => addSideOrnament(
    element,
    random,
    cx + (random() - 0.5) * 0.02,
    -primarySide,
    complexity,
    0.64 + (random() - 0.5) * 0.04
  ));

  const normalizedElements = elements
    .map((element) => element
      .map((stroke) => stroke.map((point) => ({
        x: clamp(point.x, 0.055, 0.945),
        y: clamp(point.y, 0.055, 0.945)
      })))
      .filter((stroke) => stroke.length >= 2))
    .filter((element) => element.length);
  return {
    version: 6,
    seed,
    complexity,
    elementCount: normalizedElements.length,
    grammar: "goetic-v6",
    elements: normalizedElements,
    strokes: normalizedElements.flat()
  };
}

export function createUnlockSigil(seedValue) {
  const seed = hashString(`${seedValue}:personal-simple-v4`);
  const random = mulberry32(seed);
  const cx = 0.5;
  const strokes = [];
  const type = Math.floor(random() * 4);

  if (type === 0) {
    strokes.push(line({ x: cx, y: 0.15 }, { x: cx, y: 0.84 }));
    strokes.push(line({ x: cx - 0.24, y: 0.42 }, { x: cx + 0.24, y: 0.42 }));
  } else if (type === 1) {
    strokes.push(polyline({ x: cx - 0.22, y: 0.26 }, { x: cx, y: 0.14 }, { x: cx + 0.22, y: 0.26 }, { x: cx, y: 0.84 }));
    strokes.push(line({ x: cx - 0.18, y: 0.53 }, { x: cx + 0.18, y: 0.53 }));
  } else if (type === 2) {
    strokes.push(quadratic({ x: cx - 0.24, y: 0.26 }, { x: cx, y: 0.08 }, { x: cx + 0.24, y: 0.26 }));
    strokes.push(line({ x: cx, y: 0.2 }, { x: cx, y: 0.84 }));
  } else {
    strokes.push(line({ x: cx - 0.2, y: 0.22 }, { x: cx + 0.2, y: 0.22 }));
    strokes.push(line({ x: cx, y: 0.22 }, { x: cx, y: 0.82 }));
    strokes.push(quadratic({ x: cx - 0.19, y: 0.56 }, { x: cx, y: 0.7 }, { x: cx + 0.19, y: 0.56 }));
  }

  if (strokes.length < 3 && random() < 0.55) strokes.push(circle(cx, 0.15, 0.03));

  // Personal seals deliberately carry two additional, stable ornaments.
  // It keeps the entrance sigil one step richer than the previous generation
  // without turning it into a full spell seal.
  const ornamentSide = random() < 0.5 ? -1 : 1;
  strokes.push(circle(cx + ornamentSide * 0.14, 0.64 + (random() - 0.5) * 0.04, 0.032));
  strokes.push(polyline(
    { x: cx - ornamentSide * 0.06, y: 0.72 },
    { x: cx, y: 0.78 + (random() - 0.5) * 0.03 },
    { x: cx + ornamentSide * 0.06, y: 0.72 }
  ));

  const normalizedStrokes = strokes.map((stroke) => stroke.map((point) => ({
    x: clamp(point.x, 0.06, 0.94),
    y: clamp(point.y, 0.06, 0.94)
  })));
  return {
    version: UNLOCK_SIGIL_VERSION,
    seed,
    complexity: 2,
    grammar: `personal-simple-v${UNLOCK_SIGIL_VERSION}`,
    elements: [normalizedStrokes],
    strokes: normalizedStrokes
  };
}

function densifyStroke(points, maxStep = 0.022) {
  if (!points?.length) return [];
  const result = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const steps = Math.max(1, Math.ceil(distance(from, to) / maxStep));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      result.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  }
  return result;
}

function roughenStroke(points, seed, amount) {
  const random = mulberry32(seed);
  const dense = densifyStroke(points);
  return dense.map((point, index) => {
    if (!index || index === dense.length - 1) return { ...point };
    const previous = dense[index - 1];
    const next = dense[index + 1];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = (random() - 0.5) * amount * 2;
    return {
      x: point.x + (-dy / length) * offset,
      y: point.y + (dx / length) * offset
    };
  });
}

export function pointsToSvgPath(points, width = 100, height = 100) {
  if (!points?.length) return "";
  return points
    .map((point, index) => `${index ? "L" : "M"} ${(point.x * width).toFixed(2)} ${(point.y * height).toFixed(2)}`)
    .join(" ");
}


const DEFAULT_DISPLAY_PADDING = 0.1;

function validStrokes(strokes) {
  return (Array.isArray(strokes) ? strokes : [])
    .filter((stroke) => Array.isArray(stroke))
    .map((stroke) => stroke
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) })))
    .filter((stroke) => stroke.length >= 2);
}

function geometryTransform(strokes, padding) {
  const points = strokes.flat();
  if (!points.length) return { scale: 1, xOffset: 0, yOffset: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);
  const scale = Math.min((1 - padding * 2) / width, (1 - padding * 2) / height);
  return {
    scale,
    xOffset: 0.5 - ((minX + maxX) / 2) * scale,
    yOffset: 0.5 - ((minY + maxY) / 2) * scale
  };
}

function transformStroke(stroke, transform, padding) {
  return stroke.map((point) => ({
    x: clamp(point.x * transform.scale + transform.xOffset, padding * 0.5, 1 - padding * 0.5),
    y: clamp(point.y * transform.scale + transform.yOffset, padding * 0.5, 1 - padding * 0.5)
  }));
}

export function normalizeSigilForDisplay(sigil, { padding = DEFAULT_DISPLAY_PADDING } = {}) {
  if (sigil?.displayNormalized && Number(sigil.displayPadding) === Number(padding)) return sigil;
  const sourceStrokes = validStrokes(sigil?.strokes);
  const transform = geometryTransform(sourceStrokes, padding);
  const sourceElements = Array.isArray(sigil?.elements) && sigil.elements.length
    ? sigil.elements.map((element) => validStrokes(element)).filter((element) => element.length)
    : sourceStrokes.map((stroke) => [stroke]);
  const elements = sourceElements.map((element) => element.map((stroke) => transformStroke(stroke, transform, padding)));
  return {
    ...(sigil ?? {}),
    displayNormalized: true,
    displayPadding: padding,
    elementCount: elements.length,
    elements,
    strokes: elements.flat()
  };
}

export function sigilToSvgMarkup(sigil, { className = "", viewBox = 100, guide = false } = {}) {
  const displaySigil = normalizeSigilForDisplay(sigil, { padding: DEFAULT_DISPLAY_PADDING });
  const paths = displaySigil.strokes.map((stroke, index) => {
    const baseSeed = hashString(`${displaySigil.seed ?? 0}:${index}`);
    const main = pointsToSvgPath(roughenStroke(stroke, baseSeed ^ 0xb437, guide ? 0.0018 : 0.0027), viewBox, viewBox);
    if (guide) return `<path class="gg-guide-ink" d="${main}"></path>`;
    const shadow = pointsToSvgPath(roughenStroke(stroke, baseSeed ^ 0x91a2, 0.0055), viewBox, viewBox);
    const fray = pointsToSvgPath(roughenStroke(stroke, baseSeed ^ 0xc953, 0.008), viewBox, viewBox);
    return `<path class="gg-ink-shadow" d="${shadow}"></path><path class="gg-ink-main" d="${main}"></path><path class="gg-ink-fray" d="${fray}"></path>`;
  }).join("");
  return `<svg class="gg-sigil ${className}" viewBox="0 0 ${viewBox} ${viewBox}" aria-hidden="true">${paths}</svg>`;
}

function strokeLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
  return length;
}

function pointToSegmentDistance(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const denominator = dx * dx + dy * dy;
  if (!denominator) return distance(point, from);
  const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / denominator, 0, 1);
  return distance(point, { x: from.x + dx * t, y: from.y + dy * t });
}

function pointToStrokesDistance(point, strokes) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      nearest = Math.min(nearest, pointToSegmentDistance(point, stroke[index - 1], stroke[index]));
    }
  }
  return nearest;
}

function sampleStroke(points, spacing = 0.018) {
  return densifyStroke(points, spacing);
}

function boundsForStrokes(strokes) {
  const points = strokes.flat();
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys)
  };
}

function boundsSimilarity(first, second) {
  if (!first || !second) return 0;
  const firstWidth = Math.max(0.01, first.maxX - first.minX);
  const firstHeight = Math.max(0.01, first.maxY - first.minY);
  const secondWidth = Math.max(0.01, second.maxX - second.minX);
  const secondHeight = Math.max(0.01, second.maxY - second.minY);
  const firstCenter = { x: (first.minX + first.maxX) / 2, y: (first.minY + first.maxY) / 2 };
  const secondCenter = { x: (second.minX + second.maxX) / 2, y: (second.minY + second.maxY) / 2 };
  const centerScore = clamp(1 - distance(firstCenter, secondCenter) / 0.24, 0, 1);
  const widthScore = Math.min(firstWidth, secondWidth) / Math.max(firstWidth, secondWidth);
  const heightScore = Math.min(firstHeight, secondHeight) / Math.max(firstHeight, secondHeight);
  return centerScore * 0.45 + widthScore * 0.28 + heightScore * 0.27;
}


function rasterCells(strokes, size = 52, radius = 0) {
  const cells = new Set();
  for (const stroke of strokes) {
    for (const point of densifyStroke(stroke, 1 / (size * 2))) {
      const x = clamp(Math.round(point.x * (size - 1)), 0, size - 1);
      const y = clamp(Math.round(point.y * (size - 1)), 0, size - 1);
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          if (dx * dx + dy * dy > radius * radius + 0.5) continue;
          const cellX = x + dx;
          const cellY = y + dy;
          if (cellX < 0 || cellY < 0 || cellX >= size || cellY >= size) continue;
          cells.add(`${cellX}:${cellY}`);
        }
      }
    }
  }
  return cells;
}

function overlapRatio(source, expandedTarget) {
  if (!source.size) return 0;
  let overlap = 0;
  for (const cell of source) if (expandedTarget.has(cell)) overlap += 1;
  return overlap / source.size;
}

const comparisonTargetCache = new WeakMap();

function exclusiveRasterSources(parts, { size = 72, exclusionRadius = 1 } = {}) {
  if (!parts.length) return [];
  const cores = parts.map((part) => rasterCells(part, size, 0));
  const wides = parts.map((part) => rasterCells(part, size, exclusionRadius));
  return parts.map((_part, index) => {
    const otherWide = new Set();
    for (let other = 0; other < wides.length; other += 1) {
      if (other === index) continue;
      for (const cell of wides[other]) otherWide.add(cell);
    }
    const exclusive = new Set();
    for (const cell of cores[index]) if (!otherWide.has(cell)) exclusive.add(cell);
    const minimumExclusive = Math.max(4, Math.floor(cores[index].size * 0.08));
    return exclusive.size >= minimumExclusive ? exclusive : cores[index];
  });
}

function rasterCoverages(sources, drawn, { size = 72, drawnRadius = 2 } = {}) {
  const drawnWide = rasterCells(drawn, size, drawnRadius);
  return sources.map((source) => overlapRatio(source, drawnWide));
}

function compileComparisonTarget(sigil) {
  if (sigil && typeof sigil === "object") {
    const cached = comparisonTargetCache.get(sigil);
    if (cached) return cached;
  }
  const targetSigil = normalizeSigilForDisplay(sigil, { padding: DEFAULT_DISPLAY_PADDING });
  const target = targetSigil.strokes;
  const elements = targetSigil.elements?.length ? targetSigil.elements : target.map((stroke) => [stroke]);
  const targetEntries = target.map((stroke) => ({
    stroke,
    length: Math.max(0.001, strokeLength(stroke)),
    samples: sampleStroke(stroke, 0.016)
  }));
  const targetLength = targetEntries.reduce((sum, entry) => sum + entry.length, 0);
  const elementEntries = elements.map((strokes) => {
    const entries = strokes.map((stroke) => ({
      length: Math.max(0.001, strokeLength(stroke)),
      samples: sampleStroke(stroke, 0.016)
    }));
    return { entries, totalLength: entries.reduce((sum, entry) => sum + entry.length, 0) };
  });
  const strokeLengths = target.map((stroke) => Math.max(0.001, strokeLength(stroke)));
  const totalStrokeLength = strokeLengths.reduce((sum, value) => sum + value, 0);
  const sortedStrokeIndices = strokeLengths
    .map((length, index) => ({ length, index }))
    .sort((first, second) => second.length - first.length);
  const majorStrokeIndices = [];
  let majorStrokeLength = 0;
  for (const entry of sortedStrokeIndices) {
    majorStrokeIndices.push(entry);
    majorStrokeLength += entry.length;
    if (majorStrokeLength / totalStrokeLength >= 0.88) break;
  }
  const compiled = {
    targetSigil,
    target,
    elements,
    targetEntries,
    targetLength,
    elementEntries,
    targetBounds: boundsForStrokes(target),
    targetRasterCore: rasterCells(target, 52, 0),
    targetRasterWide: rasterCells(target, 52, 2),
    elementSignatureSources: exclusiveRasterSources(elements, { size: 72, exclusionRadius: 1 }),
    strokeSignatureSources: exclusiveRasterSources(target.map((stroke) => [stroke]), { size: 76, exclusionRadius: 1 }),
    strokeLengths,
    totalStrokeLength,
    majorStrokeIndices
  };
  if (sigil && typeof sigil === "object") comparisonTargetCache.set(sigil, compiled);
  if (targetSigil && typeof targetSigil === "object") comparisonTargetCache.set(targetSigil, compiled);
  return compiled;
}

function rasterSimilarity(drawn, compiled) {
  const drawnCore = rasterCells(drawn, 52, 0);
  const drawnWide = rasterCells(drawn, 52, 2);
  const coverage = overlapRatio(compiled.targetRasterCore, drawnWide);
  const precision = overlapRatio(drawnCore, compiled.targetRasterWide);
  return { coverage, precision, score: coverage * 0.58 + precision * 0.42 };
}

function proximityScore(distanceValue, tolerance) {
  return clamp(1 - distanceValue / tolerance, 0, 1);
}

function coverageAgainstDrawing(compiledElement, drawn, tolerance) {
  if (!compiledElement.totalLength) return 0;
  let weighted = 0;
  for (const entry of compiledElement.entries) {
    const values = entry.samples.map((point) => proximityScore(pointToStrokesDistance(point, drawn), tolerance));
    const coverage = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    weighted += coverage * entry.length;
  }
  return weighted / compiledElement.totalLength;
}

export function compareDrawingToSigil(drawnStrokes, sigil, { tolerance = 0.06 } = {}) {
  const drawn = validStrokes(drawnStrokes);
  const compiled = compileComparisonTarget(sigil);
  const { target, elements, targetEntries, targetLength } = compiled;
  const empty = {
    score: 0,
    coverage: 0,
    precision: 0,
    majorCoverage: 0,
    bounds: 0,
    elementCoverage: elements.map(() => 0),
    elementSignature: elements.map(() => 0),
    averageElementCoverage: 0,
    minElementCoverage: 0,
    coveredElements: 0,
    elementCount: elements.length,
    strokeSignatureCoverage: target.map(() => 0),
    weightedStrokeSignature: 0,
    minStrokeSignatureCoverage: 0,
    minMajorStrokeCoverage: 0,
    complete: false,
    perfectEligible: false
  };
  if (!drawn.length || !target.length) return empty;

  let weightedCoverage = 0;
  const perStrokeCoverage = [];
  for (const entry of targetEntries) {
    const values = entry.samples.map((point) => proximityScore(pointToStrokesDistance(point, drawn), tolerance));
    const strokeCoverage = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    perStrokeCoverage.push({ coverage: strokeCoverage, length: entry.length });
    weightedCoverage += strokeCoverage * entry.length;
  }
  const coverage = weightedCoverage / targetLength;

  const drawnSamples = drawn.flatMap((stroke) => sampleStroke(stroke, 0.016));
  const precisionValues = drawnSamples.map((point) => proximityScore(pointToStrokesDistance(point, target), tolerance * 1.15));
  const precision = precisionValues.reduce((sum, value) => sum + value, 0) / Math.max(1, precisionValues.length);

  const elementProximity = compiled.elementEntries.map((element) => coverageAgainstDrawing(element, drawn, tolerance * 0.72));
  const elementSignature = rasterCoverages(compiled.elementSignatureSources, drawn, { size: 72, drawnRadius: 2 });
  const elementCoverage = elementProximity.map((value, index) => value * 0.35 + elementSignature[index] * 0.65);
  const averageElementCoverage = elementCoverage.reduce((sum, value) => sum + value, 0) / Math.max(1, elementCoverage.length);
  const minElementCoverage = Math.min(...elementCoverage);
  const coveredElements = elementCoverage.filter((value) => value >= 0.55).length;

  const strokeSignatureCoverage = rasterCoverages(compiled.strokeSignatureSources, drawn, { size: 76, drawnRadius: 2 });
  const { strokeLengths, totalStrokeLength, majorStrokeIndices } = compiled;
  const weightedStrokeSignature = strokeSignatureCoverage.reduce((sum, value, index) => sum + value * strokeLengths[index], 0) / totalStrokeLength;
  const minStrokeSignatureCoverage = Math.min(...strokeSignatureCoverage);
  const minMajorStrokeCoverage = Math.min(...majorStrokeIndices.map(({ index }) => strokeSignatureCoverage[index]));
  const complete = coveredElements === elements.length
    && minElementCoverage >= 0.55
    && weightedStrokeSignature >= 0.9
    && minMajorStrokeCoverage >= 0.5
    && minStrokeSignatureCoverage >= 0.5;

  const major = [...perStrokeCoverage].sort((first, second) => second.length - first.length).slice(0, Math.min(3, perStrokeCoverage.length));
  const majorCoverage = major.reduce((sum, entry) => sum + entry.coverage, 0) / Math.max(1, major.length);
  const bounds = boundsSimilarity(boundsForStrokes(drawn), compiled.targetBounds);
  const raster = rasterSimilarity(drawn, compiled);
  const drawnLength = drawn.reduce((sum, stroke) => sum + strokeLength(stroke), 0);
  const lengthRatio = drawnLength / Math.max(0.001, targetLength);
  const excessBase = clamp((lengthRatio - 1.55) * 0.18, 0, 0.3);
  const excessPenalty = excessBase * clamp((1.08 - precision) / 0.65, 0.15, 1);
  const undershootPenalty = clamp((0.72 - lengthRatio) * 0.42, 0, 0.32);
  const structure = averageElementCoverage * 0.45 + minElementCoverage * 0.2 + weightedStrokeSignature * 0.35;
  let score = clamp(
    coverage * 0.2
      + precision * 0.14
      + raster.score * 0.24
      + bounds * 0.07
      + structure * 0.35
      - excessPenalty
      - undershootPenalty,
    0,
    1
  );

  if (!complete) score = Math.min(score, 0.74);
  if (minElementCoverage < 0.22 || minMajorStrokeCoverage < 0.18 || minStrokeSignatureCoverage < 0.12) score = Math.min(score, 0.64);
  const perfectEligible = complete
    && minElementCoverage >= 0.76
    && averageElementCoverage >= 0.88
    && weightedStrokeSignature >= 0.9
    && minMajorStrokeCoverage >= 0.72
    && minStrokeSignatureCoverage >= 0.65
    && precision >= 0.82
    && raster.precision >= 0.8;

  return {
    score,
    coverage,
    precision,
    majorCoverage,
    bounds,
    rasterCoverage: raster.coverage,
    rasterPrecision: raster.precision,
    elementCoverage,
    elementSignature,
    averageElementCoverage,
    minElementCoverage,
    coveredElements,
    elementCount: elements.length,
    strokeSignatureCoverage,
    weightedStrokeSignature,
    minStrokeSignatureCoverage,
    minMajorStrokeCoverage,
    complete,
    perfectEligible
  };
}

