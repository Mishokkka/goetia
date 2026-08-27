import { setCastFxPresenter } from "./cast-network.js";
import { MODULE_ID } from "./config.js";
import { playConfiguredSound } from "./audio-service.js";
import { normalizeSigilForDisplay, sigilToSvgMarkup } from "./sigil.js";
import { samplePoints } from "./drawing-controller.js";

const MAX_FX_ENHANCEMENTS = 12;
const MAX_FX_STROKES = 64;
const MAX_FX_POINTS_PER_STROKE = 48;
const MAX_FX_TOTAL_POINTS = 720;
const MAX_CAST_FX_QUEUE = 6;
const castFxQueue = [];
let activeCastFx = null;
let castFxQueueRunning = false;

function castFxDurationMs() {
  try {
    const value = Number(game.settings.get(MODULE_ID, "castFxDurationMs"));
    return clamp(Math.round(value) || 1700, 800, 6000);
  } catch (_error) {
    return 1700;
  }
}

function castFxSoundDurationMultiplier() {
  try {
    const value = Number(game.settings.get(MODULE_ID, "castFxSoundDurationMultiplier"));
    return clamp(Number.isFinite(value) ? value : 1.5, 0.5, 2);
  } catch (_error) {
    return 1.5;
  }
}

export function registerCastFxSettings() {
  game.settings.register(MODULE_ID, "castFxDurationMs", {
    name: "GG.Settings.CastFxDuration",
    hint: "GG.Settings.CastFxDurationHint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 800, max: 6000, step: 100 },
    default: 1700
  });

  game.settings.register(MODULE_ID, "castFxSoundDurationMultiplier", {
    name: "GG.Settings.CastFxSoundDurationMultiplier",
    hint: "GG.Settings.CastFxSoundDurationMultiplierHint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0.5, max: 2, step: 0.05 },
    default: 1.5
  });
}


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function radialLayout(count, { radius = 49, startAngle = -90 } = {}) {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const angle = startAngle + (360 / count) * index;
    const radians = (angle * Math.PI) / 180;
    return { index, angle, x: 50 + Math.cos(radians) * radius, y: 50 + Math.sin(radians) * radius };
  });
}

function unpackNormalizedStrokes(strokes) {
  const entries = Array.isArray(strokes) ? strokes : [];
  return entries.map((stroke) => {
    if (!Array.isArray(stroke)) return [];
    if (stroke.length && typeof stroke[0] === "number") {
      const points = [];
      for (let index = 0; index + 1 < stroke.length; index += 2) {
        const x = Number(stroke[index]);
        const y = Number(stroke[index + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x: clamp(x / 1000, 0, 1), y: clamp(y / 1000, 0, 1) });
      }
      return points;
    }
    return stroke;
  });
}

function compactNormalizedStrokes(strokes, {
  maxStrokes = MAX_FX_STROKES,
  maxPointsPerStroke = MAX_FX_POINTS_PER_STROKE,
  maxTotalPoints = MAX_FX_TOTAL_POINTS
} = {}) {
  const entries = unpackNormalizedStrokes(strokes)
    .filter(Array.isArray)
    .slice(0, maxStrokes)
    .map((stroke) => stroke.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)))
    .filter((stroke) => stroke.length >= 2);
  if (!entries.length) return [];
  const perStrokeBudget = Math.max(2, Math.min(maxPointsPerStroke, Math.floor(maxTotalPoints / entries.length)));
  return entries.map((stroke) => samplePoints(stroke, perStrokeBudget).map((point) => ({
    x: Math.round(clamp(point.x, 0, 1) * 10000) / 10000,
    y: Math.round(clamp(point.y, 0, 1) * 10000) / 10000
  })));
}

function castEnhancementMarkup(enhancements) {
  const entries = (Array.isArray(enhancements) ? enhancements : [])
    .slice(0, MAX_FX_ENHANCEMENTS)
    .map((strokes) => compactNormalizedStrokes(strokes))
    .filter((strokes) => strokes.length);
  const slots = radialLayout(entries.length, { radius: 43 });
  return entries.map((strokes, index) => {
    const slot = slots[index];
    const sigil = { seed: `cast-enhancement:${index}`, strokes };
    return `<div class="gg-cast-fx-enhancement" style="left:${slot.x}%;top:${slot.y}%">${sigilToSvgMarkup(sigil, { className: "gg-cast-fx-enhancement-svg" })}</div>`;
  }).join("");
}

function averagePoint(points) {
  if (!points.length) return { x: 0.5, y: 0.5 };
  const sum = points.reduce((accumulator, point) => ({
    x: accumulator.x + point.x,
    y: accumulator.y + point.y
  }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function splitMishapSigil(strokes, severity = 1) {
  const entries = Array.isArray(strokes) ? strokes.filter((stroke) => Array.isArray(stroke) && stroke.length >= 2) : [];
  if (entries.length <= 1) return [{ strokes: entries, angle: -Math.PI / 2 }];
  const allPoints = entries.flat();
  const center = averagePoint(allPoints);
  const shardCount = clamp(Math.min(entries.length, 2 + Math.ceil(severity / 2), 5), 2, 5);
  const annotated = entries.map((stroke, index) => {
    const point = averagePoint(stroke);
    const angle = Math.atan2(point.y - center.y, point.x - center.x);
    return { stroke, point, angle, index };
  }).sort((left, right) => left.angle - right.angle || left.index - right.index);

  const shards = Array.from({ length: shardCount }, () => []);
  const baseSize = Math.floor(annotated.length / shardCount);
  let remainder = annotated.length % shardCount;
  let cursor = 0;
  for (let index = 0; index < shardCount; index += 1) {
    const size = baseSize + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    shards[index] = annotated.slice(cursor, cursor + size);
    cursor += size;
  }

  return shards
    .filter((group) => group.length)
    .map((group) => {
      const groupCenter = averagePoint(group.map((entry) => entry.point));
      return {
        strokes: group.map((entry) => entry.stroke),
        angle: Math.atan2(groupCenter.y - center.y, groupCenter.x - center.x)
      };
    });
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function castSigilMarkup(sigilStrokes, payload) {
  const baseSigil = { seed: payload?.sigil?.seed ?? "cast", strokes: sigilStrokes };
  if (!payload?.mishap) return sigilToSvgMarkup(baseSigil, { className: "gg-cast-fx-svg" });

  const severity = clamp(Number(payload?.mishapSeverity) || 1, 1, 6);
  const displaySigil = normalizeSigilForDisplay(baseSigil);
  const distance = 7 + severity * 2.15;
  const rotation = 1.4 + severity * 0.6;
  const wander = 2.4 + severity * 0.7;
  const shards = splitMishapSigil(displaySigil.strokes, severity);

  return `<div class="gg-cast-fx-shards">${shards.map((shard, index) => {
    const dx = Math.cos(shard.angle) * distance;
    const dy = Math.sin(shard.angle) * distance;
    const rotate = ((index % 2 === 0 ? 1 : -1) * rotation) + (Math.sin(shard.angle) * 0.75);
    const outwardDelay = Math.min(0.24, index * 0.025);
    const wanderDuration = randomBetween(1.25, 2.25);
    const wanderDelay = -randomBetween(0, wanderDuration);
    const x1 = randomBetween(-wander, wander);
    const y1 = randomBetween(-wander, wander);
    const x2 = randomBetween(-wander, wander);
    const y2 = randomBetween(-wander, wander);
    const x3 = randomBetween(-wander, wander);
    const y3 = randomBetween(-wander, wander);
    const r1 = randomBetween(-rotation, rotation);
    const r2 = randomBetween(-rotation, rotation);
    const r3 = randomBetween(-rotation, rotation);
    const shardSigil = {
      seed: `${baseSigil.seed}:mishap:${index}`,
      displayNormalized: true,
      displayPadding: displaySigil.displayPadding,
      strokes: shard.strokes
    };
    const style = [
      `--gg-shard-dx:${dx.toFixed(2)}px`,
      `--gg-shard-dy:${dy.toFixed(2)}px`,
      `--gg-shard-rot:${rotate.toFixed(2)}deg`,
      `--gg-shard-delay:${outwardDelay.toFixed(2)}s`,
      `--gg-wander-duration:${wanderDuration.toFixed(2)}s`,
      `--gg-wander-delay:${wanderDelay.toFixed(2)}s`,
      `--gg-wander-x1:${x1.toFixed(2)}px`,
      `--gg-wander-y1:${y1.toFixed(2)}px`,
      `--gg-wander-x2:${x2.toFixed(2)}px`,
      `--gg-wander-y2:${y2.toFixed(2)}px`,
      `--gg-wander-x3:${x3.toFixed(2)}px`,
      `--gg-wander-y3:${y3.toFixed(2)}px`,
      `--gg-wander-r1:${r1.toFixed(2)}deg`,
      `--gg-wander-r2:${r2.toFixed(2)}deg`,
      `--gg-wander-r3:${r3.toFixed(2)}deg`
    ].join(";");
    return `<div class="gg-cast-fx-shard" style="${style}"><div class="gg-cast-fx-shard-motion">${sigilToSvgMarkup(shardSigil, { className: "gg-cast-fx-svg" })}</div></div>`;
  }).join("")}</div>`;
}

function disposeCastFx(state) {
  if (!state || state.disposed) return;
  state.disposed = true;
  clearTimeout(state.fadeTimer);
  clearTimeout(state.removeTimer);
  state.node?.remove?.();
  if (activeCastFx === state) activeCastFx = null;
  const resolve = state.resolve;
  state.resolve = null;
  resolve?.();
}

async function scheduleCastFxLifetime(state) {
  const fallbackDurationMs = castFxDurationMs();
  let audioDurationMs = 0;
  if (state.audioHandle?.durationPromise) {
    try {
      audioDurationMs = Math.max(0, Number(await state.audioHandle.durationPromise) || 0);
    } catch (_error) {}
  }
  if (state.disposed) return;

  const targetDurationMs = audioDurationMs > 0
    ? Math.round(audioDurationMs * castFxSoundDurationMultiplier())
    : fallbackDurationMs;
  const origin = audioDurationMs > 0 && state.audioHandle?.startedAt > 0 ? state.audioHandle.startedAt : state.shownAt;
  const deadline = origin + targetDurationMs;
  const remainingMs = Math.max(120, deadline - performance.now());
  const fadeWindowMs = Math.min(720, Math.max(260, Math.round(targetDurationMs * 0.2)));
  const fadeDelayMs = Math.max(0, remainingMs - fadeWindowMs);

  state.fadeTimer = window.setTimeout(() => {
    if (!state.disposed) state.node?.classList?.add("is-fading");
  }, fadeDelayMs);
  state.removeTimer = window.setTimeout(() => disposeCastFx(state), remainingMs);
}

function playCastFx(payload) {
  const sigilStrokes = compactNormalizedStrokes(payload?.sigil?.strokes);
  if (!sigilStrokes.length) return Promise.resolve();
  const enhancements = (Array.isArray(payload?.enhancements) ? payload.enhancements : [])
    .slice(0, MAX_FX_ENHANCEMENTS)
    .map((entry) => compactNormalizedStrokes(entry))
    .filter((entry) => entry.length);

  document.querySelectorAll(".gg-cast-fx-overlay").forEach((node) => node.remove());
  const overlay = document.createElement("div");
  overlay.className = `gg-cast-fx-overlay${payload?.mishap ? " is-mishap" : ""}`;
  if (payload?.mishap) {
    const severity = clamp(Number(payload?.mishapSeverity) || 1, 1, 6);
    const mishapAngle = 1.4 + severity * 0.34;
    const mishapShift = 0.8 + severity * 0.45;
    overlay.style.setProperty("--gg-mishap-angle", `${mishapAngle.toFixed(2)}deg`);
    overlay.style.setProperty("--gg-mishap-angle-neg", `${(-mishapAngle).toFixed(2)}deg`);
    overlay.style.setProperty("--gg-mishap-shift", `${mishapShift.toFixed(2)}px`);
    overlay.style.setProperty("--gg-mishap-shift-neg", `${(-mishapShift).toFixed(2)}px`);
    const twistSpeed = Math.max(0.44, 0.92 - severity * 0.06);
    overlay.style.setProperty("--gg-mishap-speed", `${twistSpeed.toFixed(2)}s`);
    overlay.style.setProperty("--gg-mishap-warp-speed", `${(twistSpeed * 0.74).toFixed(2)}s`);
  }
  overlay.innerHTML = `
    <div class="gg-cast-fx-stage">
      <div class="gg-cast-fx-sigil${payload?.mishap ? " is-shattered" : ""}">${castSigilMarkup(sigilStrokes, payload)}</div>
      <div class="gg-cast-fx-enhancements">${castEnhancementMarkup(enhancements)}</div>
    </div>
    <div class="gg-cast-fx-label">${escapeHtml(payload.actorName ?? "")} — ${escapeHtml(payload.spellName ?? "")}</div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    if (overlay.isConnected) overlay.classList.add("is-visible");
  });
  let audioHandle = null;
  if (payload?.mishap) {
    audioHandle = playConfiguredSound("castFxMishap", { minimumInterval: 0 });
  } else {
    if (Number(payload?.powerLevel ?? 0) > 5) {
      audioHandle = playConfiguredSound("castFxHighPower", { minimumInterval: 0 });
    }
    if (!audioHandle) audioHandle = playConfiguredSound("castFx", { minimumInterval: 0 });
  }

  return new Promise((resolve) => {
    const state = {
      node: overlay,
      audioHandle,
      shownAt: performance.now(),
      fadeTimer: 0,
      removeTimer: 0,
      resolve,
      disposed: false
    };
    activeCastFx = state;
    void scheduleCastFxLifetime(state);
  });
}

async function drainCastFxQueue() {
  if (castFxQueueRunning) return;
  castFxQueueRunning = true;
  try {
    while (castFxQueue.length) {
      const payload = castFxQueue.shift();
      try {
        await playCastFx(payload);
      } catch (error) {
        console.warn("Goetia Grimoire | Cast effect failed.", error);
        disposeCastFx(activeCastFx);
      }
    }
  } finally {
    castFxQueueRunning = false;
  }
}

export function enqueueCastFx(payload) {
  if (!payload?.sigil?.strokes?.length) return;
  if (castFxQueue.length >= MAX_CAST_FX_QUEUE) castFxQueue.shift();
  castFxQueue.push(payload);
  void drainCastFxQueue();
}

export function initializeCastFx() {
  setCastFxPresenter(enqueueCastFx);
}

export function shutdownCastFx() {
  castFxQueue.length = 0;
  disposeCastFx(activeCastFx);
  activeCastFx = null;
}
