import { hashString, mulberry32 } from "./sigil.js";
import { startDrawingSound, stopDrawingSound } from "./audio-service.js";

export const DEFAULT_DRAWING_LIMITS = Object.freeze({
  maxStrokes: 32,
  maxPointsPerStroke: 128,
  maxTotalPoints: 2048
});

const MAX_CANVAS_PIXEL_RATIO = 1.5;
const MIN_POINT_DISTANCE = 1.35;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createBackingCanvas() {
  if (typeof globalThis.document?.createElement === "function") return globalThis.document.createElement("canvas");
  return null;
}

function canvasMetrics(canvas) {
  const ratio = clamp(window.devicePixelRatio || 1, 1, MAX_CANVAS_PIXEL_RATIO);
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, bounds.width || canvas.clientWidth || canvas.parentElement?.clientWidth || 1);
  const cssHeight = Math.max(1, bounds.height || canvas.clientHeight || canvas.parentElement?.clientHeight || 1);
  return {
    ratio,
    rect: { left: bounds.left || 0, top: bounds.top || 0, width: cssWidth, height: cssHeight },
    width: Math.max(1, Math.round(cssWidth * ratio)),
    height: Math.max(1, Math.round(cssHeight * ratio))
  };
}

function configureCanvas(canvas, metrics) {
  if (!canvas) return { context: null, changed: false };
  const changed = canvas.width !== metrics.width || canvas.height !== metrics.height;
  if (changed) {
    canvas.width = metrics.width;
    canvas.height = metrics.height;
  }
  let context = null;
  try {
    context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  } catch (_error) {
    context = canvas.getContext("2d");
  }
  if (!context) return { context: null, changed };
  context.setTransform(metrics.ratio, 0, 0, metrics.ratio, 0, 0);
  return { context, changed };
}

function toCanvasPoint(point, rect, normalized = false) {
  return normalized
    ? { x: point.x * rect.width, y: point.y * rect.height }
    : { x: point.x, y: point.y };
}

function roughCanvasPoints(points, rect, seed, amount, normalized = false) {
  const random = mulberry32(seed);
  const scaled = points.map((point) => toCanvasPoint(point, rect, normalized));
  return scaled.map((point, index) => {
    if (!index || index === scaled.length - 1) return point;
    const previous = scaled[index - 1];
    const next = scaled[index + 1];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = (random() - 0.5) * amount * 2;
    return { x: point.x + (-dy / length) * offset, y: point.y + (dx / length) * offset };
  });
}

function traceCanvasPath(context, points) {
  if (!points?.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  context.stroke();
}

function strokeSeed(points, salt = 0) {
  const signature = points.slice(0, 16).map((point) => `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`).join(";");
  return hashString(`${signature}:${points.length}:${salt}`);
}

function drawRoughCanvasStroke(context, rect, points, { guide = false, ritual = false, unlock = false, normalized = false } = {}) {
  if (!points?.length) return;
  const seed = strokeSeed(points, guide ? 91 : 37);
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (guide) {
    context.strokeStyle = "rgba(212, 204, 190, .105)";
    context.lineWidth = 1.15;
    context.setLineDash([2, 4.5]);
    traceCanvasPath(context, roughCanvasPoints(points, rect, seed, 1.1, normalized));
    context.restore();
    return;
  }

  context.strokeStyle = ritual ? "rgba(112, 5, 18, .96)" : unlock ? "rgba(145, 10, 24, .98)" : "rgba(47, 2, 8, .74)";
  context.lineWidth = ritual ? 6.2 : unlock ? 6.6 : 5.1;
  context.shadowColor = ritual ? "rgba(224, 28, 45, .82)" : unlock ? "rgba(205, 24, 44, .88)" : "rgba(120, 0, 12, .5)";
  context.shadowBlur = ritual ? 9 : unlock ? 11 : 5;
  traceCanvasPath(context, roughCanvasPoints(points, rect, seed ^ 0xa31, ritual ? 1.35 : unlock ? 1.1 : 1.7, normalized));

  context.shadowBlur = ritual ? 4 : unlock ? 7 : 0;
  context.shadowColor = ritual ? "rgba(255, 224, 196, .68)" : unlock ? "rgba(255, 235, 214, .72)" : "transparent";
  context.strokeStyle = ritual ? "rgba(255, 239, 214, .96)" : unlock ? "rgba(255, 242, 220, .98)" : "rgba(218, 211, 194, .76)";
  context.lineWidth = ritual ? 2.7 : unlock ? 2.9 : 2.25;
  traceCanvasPath(context, roughCanvasPoints(points, rect, seed ^ 0x71c, ritual ? 0.65 : unlock ? 0.58 : 0.85, normalized));

  context.globalAlpha = ritual ? 0.68 : unlock ? 0.78 : 0.42;
  context.strokeStyle = ritual ? "rgba(255, 255, 244, .96)" : unlock ? "rgba(255, 255, 245, .98)" : "rgba(248, 238, 216, .8)";
  context.lineWidth = ritual ? 0.95 : unlock ? 1.05 : 0.72;
  context.setLineDash([0.8, 2.6, 1.2, 4.2]);
  traceCanvasPath(context, roughCanvasPoints(points, rect, seed ^ 0xd4f, 2.2, normalized));
  context.restore();
}

function drawLiveCanvasStroke(context, points, { ritual = false, unlock = false } = {}) {
  if (!points?.length) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = ritual ? "rgba(224, 28, 45, .82)" : unlock ? "rgba(205, 24, 44, .88)" : "rgba(120, 0, 12, .5)";
  context.shadowBlur = ritual ? 8 : unlock ? 10 : 0;
  context.strokeStyle = ritual ? "rgba(112, 5, 18, .96)" : unlock ? "rgba(137, 8, 23, .94)" : "rgba(48, 2, 8, .7)";
  context.lineWidth = ritual ? 5.8 : unlock ? 5.5 : 4.3;
  traceCanvasPath(context, points);
  context.shadowBlur = ritual ? 3 : unlock ? 5 : 0;
  context.strokeStyle = ritual ? "rgba(255, 239, 214, .98)" : unlock ? "rgba(255, 240, 218, .96)" : "rgba(220, 212, 195, .74)";
  context.lineWidth = ritual ? 2.45 : unlock ? 2.5 : 2;
  traceCanvasPath(context, points);
  context.restore();
}

function partialStroke(points, progress) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const clamped = clamp(Number(progress) || 0, 0, 1);
  if (clamped <= 0) return [points[0], points[0]];
  if (clamped >= 1) return points.map((point) => ({ ...point }));

  const segments = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ from, to, length });
    totalLength += length;
  }
  if (totalLength <= 0.001) return points.map((point) => ({ ...point }));

  const targetLength = totalLength * clamped;
  const result = [{ ...points[0] }];
  let traversed = 0;
  for (const segment of segments) {
    if (segment.length <= 0) continue;
    const nextTraversed = traversed + segment.length;
    if (nextTraversed <= targetLength) {
      result.push({ ...segment.to });
      traversed = nextTraversed;
      continue;
    }
    const remaining = targetLength - traversed;
    const t = clamp(remaining / segment.length, 0, 1);
    result.push({
      x: segment.from.x + (segment.to.x - segment.from.x) * t,
      y: segment.from.y + (segment.to.y - segment.from.y) * t
    });
    break;
  }
  return result.length >= 2 ? result : [points[0], points[0]];
}

function pointerPositionFromRect(event, rect) {
  return {
    x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
    y: Math.min(rect.height, Math.max(0, event.clientY - rect.top))
  };
}

export function normalizedCanvasStrokes(canvas, strokes) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || canvas.clientWidth || 1);
  const height = Math.max(1, rect.height || canvas.clientHeight || 1);
  return (Array.isArray(strokes) ? strokes : [])
    .filter(Array.isArray)
    .map((stroke) => stroke
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: clamp(point.x / width, 0, 1), y: clamp(point.y / height, 0, 1) })))
    .filter((stroke) => stroke.length >= 2);
}

export function denormalizeCanvasStrokes(canvas, strokes) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || canvas.clientWidth || 1);
  const height = Math.max(1, rect.height || canvas.clientHeight || 1);
  return (Array.isArray(strokes) ? strokes : [])
    .filter(Array.isArray)
    .map((stroke) => stroke
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: clamp(point.x * width, 0, width), y: clamp(point.y * height, 0, height) })))
    .filter((stroke) => stroke.length >= 2);
}

export function samplePoints(points, limit) {
  const entries = Array.isArray(points) ? points : [];
  const maximum = Math.max(2, Math.floor(Number(limit) || 2));
  if (entries.length <= maximum) return entries.map((point) => ({ ...point }));
  const step = (entries.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => ({ ...entries[Math.round(index * step)] }));
}

function totalDrawingPoints(strokes) {
  return (Array.isArray(strokes) ? strokes : []).reduce((sum, stroke) => sum + (Array.isArray(stroke) ? stroke.length : 0), 0);
}

function boundedDrawingStrokes(strokes, limits) {
  const { maxStrokes, maxPointsPerStroke, maxTotalPoints } = limits;
  const valid = (Array.isArray(strokes) ? strokes : [])
    .filter(Array.isArray)
    .slice(0, Math.max(1, Math.floor(maxStrokes)))
    .map((stroke) => stroke.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)))
    .filter((stroke) => stroke.length >= 2);
  const result = [];
  let remaining = Math.max(2, Math.floor(maxTotalPoints));
  for (const stroke of valid) {
    if (remaining < 2) break;
    const sampled = samplePoints(stroke, Math.min(maxPointsPerStroke, remaining));
    if (sampled.length < 2) continue;
    result.push(sampled);
    remaining -= sampled.length;
  }
  return result;
}

export function attachDrawing(canvas, options = {}) {
  const limits = {
    maxStrokes: options.maxStrokes ?? DEFAULT_DRAWING_LIMITS.maxStrokes,
    maxPointsPerStroke: options.maxPointsPerStroke ?? DEFAULT_DRAWING_LIMITS.maxPointsPerStroke,
    maxTotalPoints: options.maxTotalPoints ?? DEFAULT_DRAWING_LIMITS.maxTotalPoints
  };
  const getGuide = options.getGuide ?? (() => []);
  const drawGuide = options.drawGuide ?? true;
  const backingCanvas = createBackingCanvas();
  const drawingHost = canvas.closest?.(".gg-closed, .gg-ritual-circle, .gg-extra-slot") ?? null;
  let active = false;
  let activePointerId = null;
  let activeRect = null;
  let activeStroke = [];
  let pendingStroke = [];
  let committed = [];
  let enabled = true;
  let drawingAudio = null;
  let pendingCommit = false;
  let idlePromise = Promise.resolve();
  let destroyed = false;
  let redrawFrame = 0;
  let backingDirty = true;
  let metricsDirty = true;
  let lastMetrics = null;
  let playback = null;
  let animationFrame = 0;
  let animationResolve = null;
  let playbackPreviousEnabled = null;

  const markBackingDirty = () => {
    backingDirty = true;
  };

  const redrawNow = () => {
    const metrics = metricsDirty || !lastMetrics ? canvasMetrics(canvas) : lastMetrics;
    metricsDirty = false;
    const { context, changed } = configureCanvas(canvas, metrics);
    if (!context) return;
    const backing = configureCanvas(backingCanvas, metrics);
    if (changed || backing.changed || !lastMetrics || lastMetrics.width !== metrics.width || lastMetrics.height !== metrics.height) backingDirty = true;
    lastMetrics = metrics;
    const ritual = canvas.classList.contains("gg-ritual-canvas") || canvas.classList.contains("gg-extra-canvas");
    const unlock = canvas.classList.contains("gg-unlock-canvas");

    if (backingDirty && backing.context) {
      backing.context.clearRect(0, 0, metrics.rect.width, metrics.rect.height);
      if (drawGuide) {
        for (const stroke of getGuide?.() ?? []) drawRoughCanvasStroke(backing.context, metrics.rect, stroke, { guide: true, ritual, unlock, normalized: true });
      }
      for (const stroke of committed) drawRoughCanvasStroke(backing.context, metrics.rect, stroke, { ritual, unlock });
      backingDirty = false;
    }

    context.clearRect(0, 0, metrics.rect.width, metrics.rect.height);
    if (backingCanvas) {
      context.drawImage(
        backingCanvas,
        0,
        0,
        backingCanvas.width,
        backingCanvas.height,
        0,
        0,
        metrics.rect.width,
        metrics.rect.height
      );
    }
    const preview = activeStroke.length ? activeStroke : pendingStroke;
    if (preview.length) drawLiveCanvasStroke(context, preview, { ritual, unlock });
    if (playback?.strokes?.length) {
      const progress = clamp(Number(playback.progress) || 0, 0, 1);
      for (const stroke of playback.strokes) {
        const partial = partialStroke(stroke, progress);
        if (partial.length >= 2) drawLiveCanvasStroke(context, partial, { ritual, unlock });
      }
    }
  };

  const redraw = ({ staticLayer = false } = {}) => {
    if (destroyed) return;
    if (staticLayer) markBackingDirty();
    if (redrawFrame) return;
    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = 0;
      if (!destroyed && canvas.isConnected) redrawNow();
    });
  };

  const notifyChange = () => options.onChange?.(committed.map((stroke) => stroke.map((point) => ({ ...point }))));
  const stopActiveSound = () => {
    stopDrawingSound(drawingAudio);
    drawingAudio = null;
  };
  const setDrawingState = (value) => drawingHost?.classList.toggle("is-drawing", Boolean(value));

  const appendEventPoints = (event) => {
    const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
    const entries = events.length ? events : [event];
    let changed = false;
    for (const entry of entries) {
      const point = pointerPositionFromRect(entry, activeRect);
      const previous = activeStroke.at(-1);
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= MIN_POINT_DISTANCE) {
        activeStroke.push(point);
        changed = true;
      }
    }
    if (activeStroke.length > limits.maxPointsPerStroke) {
      activeStroke = samplePoints(activeStroke, Math.max(2, Math.floor(limits.maxPointsPerStroke * 0.78)));
      changed = true;
    }
    return changed;
  };

  const start = (event) => {
    if (destroyed || pendingCommit || !enabled || active || (event.button !== undefined && event.button !== 0)) return;
    if (committed.length >= limits.maxStrokes || totalDrawingPoints(committed) >= limits.maxTotalPoints) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    event.preventDefault();
    event.stopPropagation();
    active = true;
    activePointerId = event.pointerId ?? null;
    activeRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    if (lastMetrics && Math.abs(lastMetrics.rect.width - rect.width) < 0.5 && Math.abs(lastMetrics.rect.height - rect.height) < 0.5) {
      lastMetrics = { ...lastMetrics, rect: { ...lastMetrics.rect, ...activeRect } };
    } else {
      metricsDirty = true;
      markBackingDirty();
    }
    stopActiveSound();
    drawingAudio = startDrawingSound();
    activeStroke = [pointerPositionFromRect(event, activeRect)];
    pendingStroke = [];
    setDrawingState(true);
    try { canvas.setPointerCapture?.(event.pointerId); } catch (_error) {}
    redraw();
  };

  const move = (event) => {
    if (!active || (activePointerId !== null && event.pointerId !== activePointerId)) return;
    event.preventDefault();
    if (appendEventPoints(event)) redraw();
  };

  const finish = async (event, { cancelled = false } = {}) => {
    if (!active || (activePointerId !== null && event.pointerId !== activePointerId)) return;
    event.preventDefault?.();
    if (!cancelled) appendEventPoints(event);
    active = false;
    activePointerId = null;
    activeRect = null;
    stopActiveSound();
    setDrawingState(false);
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId);
    } catch (_error) {}

    const remainingPoints = Math.max(0, limits.maxTotalPoints - totalDrawingPoints(committed));
    const stroke = samplePoints(activeStroke, Math.min(limits.maxPointsPerStroke, remainingPoints));
    activeStroke = [];
    if (!cancelled && remainingPoints >= 2 && stroke.length >= 2 && committed.length < limits.maxStrokes) {
      const candidate = [...committed, stroke];
      pendingCommit = true;
      pendingStroke = stroke;
      redraw();
      const commitTask = (async () => {
        try {
          const decision = await options.onStrokeComplete?.(stroke, candidate);
          if (!destroyed && decision !== false && decision?.commit !== false) {
            committed.push(stroke);
            markBackingDirty();
            notifyChange();
          }
        } catch (error) {
          console.error("Goetia Grimoire | Drawing callback failed.", error);
        } finally {
          pendingStroke = [];
          pendingCommit = false;
        }
      })();
      idlePromise = commitTask.catch(() => {});
      await commitTask;
    }
    if (!destroyed) redraw();
  };

  const cancel = (event) => finish(event, { cancelled: true });
  const loseCapture = (event) => { void finish(event, { cancelled: true }); };

  const cancelPlayback = ({ redrawCanvas = true } = {}) => {
    if (!playback && !animationResolve) return;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    playback = null;
    enabled = playbackPreviousEnabled == null ? enabled : playbackPreviousEnabled;
    playbackPreviousEnabled = null;
    canvas.classList.toggle("is-disabled", !enabled);
    canvas.setAttribute("aria-disabled", String(!enabled));
    stopActiveSound();
    setDrawingState(false);
    const resolve = animationResolve;
    animationResolve = null;
    if (typeof resolve === "function") resolve([]);
    if (redrawCanvas && !destroyed) redraw();
  };

  const animateCommitted = (strokes, { duration = 1000, normalized = false, replace = true } = {}) => {
    if (destroyed || active || pendingCommit) return Promise.resolve([]);
    cancelPlayback();
    const metrics = canvasMetrics(canvas);
    lastMetrics = metrics;
    metricsDirty = false;
    const pixelStrokes = boundedDrawingStrokes(
      normalized
        ? (Array.isArray(strokes) ? strokes : []).filter(Array.isArray).map((stroke) => stroke.map((point) => ({
            x: clamp(Number(point?.x) * metrics.rect.width, 0, metrics.rect.width),
            y: clamp(Number(point?.y) * metrics.rect.height, 0, metrics.rect.height)
          })))
        : strokes,
      limits
    );
    if (replace) {
      committed = [];
      notifyChange();
      markBackingDirty();
    }
    if (!pixelStrokes.length) {
      redraw({ staticLayer: true });
      return Promise.resolve([]);
    }

    const baseDuration = Math.max(80, Number(duration) || 1000);
    playbackPreviousEnabled = enabled;
    enabled = false;
    canvas.classList.add("is-disabled");
    canvas.setAttribute("aria-disabled", "true");
    playback = { strokes: pixelStrokes, progress: 0 };
    stopActiveSound();
    drawingAudio = startDrawingSound();
    setDrawingState(true);
    redraw();

    let resolveAnimation;
    const promise = new Promise((resolve) => {
      resolveAnimation = resolve;
    });
    animationResolve = resolveAnimation;
    idlePromise = promise;

    const startTime = performance.now();
    const step = (now) => {
      if (!playback || destroyed) return;
      const progress = clamp((now - startTime) / baseDuration, 0, 1);
      playback.progress = progress;
      redraw();
      if (progress >= 1) {
        playback = null;
        animationFrame = 0;
        animationResolve = null;
        committed = replace ? pixelStrokes : [...committed, ...pixelStrokes];
        markBackingDirty();
        notifyChange();
        enabled = playbackPreviousEnabled == null ? enabled : playbackPreviousEnabled;
        playbackPreviousEnabled = null;
        canvas.classList.toggle("is-disabled", !enabled);
        canvas.setAttribute("aria-disabled", String(!enabled));
        stopActiveSound();
        setDrawingState(false);
        redraw({ staticLayer: true });
        resolveAnimation(pixelStrokes.map((stroke) => stroke.map((point) => ({ ...point }))));
        return;
      }
      animationFrame = requestAnimationFrame(step);
    };
    animationFrame = requestAnimationFrame(step);
    return promise;
  };

  const handleResize = () => {
    metricsDirty = true;
    redraw({ staticLayer: true });
  };
  const resizeObserver = globalThis.ResizeObserver ? new ResizeObserver(handleResize) : null;
  canvas.style.pointerEvents = "auto";
  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("lostpointercapture", loseCapture);
  const windowResize = handleResize;
  window.addEventListener("resize", windowResize);
  resizeObserver?.observe(canvas);
  redraw({ staticLayer: true });

  return {
    canvas,
    redraw: () => redraw({ staticLayer: true }),
    getStrokes: () => committed.map((stroke) => stroke.map((point) => ({ ...point }))),
    whenIdle: () => idlePromise,
    isBusy: () => active || pendingCommit || Boolean(playback),
    autoDraw(strokes, options = {}) {
      return animateCommitted(strokes, { duration: 1000, normalized: true, replace: true, ...options });
    },
    undo() {
      if (destroyed || active || pendingCommit || playback) return;
      committed.pop();
      markBackingDirty();
      notifyChange();
      redraw();
    },
    clear() {
      if (destroyed || active || pendingCommit || playback) return;
      committed = [];
      markBackingDirty();
      notifyChange();
      redraw();
    },
    setCommitted(strokes) {
      if (destroyed || active || pendingCommit || playback) return;
      committed = boundedDrawingStrokes(strokes, limits);
      markBackingDirty();
      notifyChange();
      redraw();
    },
    setEnabled(value) {
      if (destroyed) return;
      enabled = Boolean(value);
      canvas.classList.toggle("is-disabled", !enabled);
      canvas.setAttribute("aria-disabled", String(!enabled));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      canvas.removeEventListener("pointerdown", start);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", finish);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("lostpointercapture", loseCapture);
      window.removeEventListener("resize", windowResize);
      resizeObserver?.disconnect();
      if (redrawFrame) cancelAnimationFrame(redrawFrame);
      redrawFrame = 0;
      cancelPlayback({ redrawCanvas: false });
      stopActiveSound();
      setDrawingState(false);
      active = false;
      activePointerId = null;
      activeRect = null;
      pendingStroke = [];
    }
  };
}
