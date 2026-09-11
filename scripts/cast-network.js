import {
  MODULE_ID,
  PERFECT_SIGIL_SIMILARITY,
  SPELL_BIND_MIN_SIMILARITY,
  hasPsychicPower,
  isMiracleWorker,
  requiresChanceCasting,
  spellSigilSeed
} from "./config.js";
import { castSpellFromGrimoire } from "./cast-adapter.js";
import { drawConfiguredMishapTable } from "./mishap-service.js";
import {
  compareDrawingToSigil,
  createSpellSigil,
  normalizeSigilForDisplay
} from "./sigil.js";
import { activeAuthoritativeGm } from "./user-authority.js";

const PROTOCOL_VERSION = 3;
const REQUEST_TIMEOUT_MS = 15000;
const REQUEST_MAX_AGE_MS = 60000;
const REQUEST_RATE_WINDOW_MS = 10000;
const REQUEST_RATE_LIMIT = 5;
const GLOBAL_REQUEST_RATE_LIMIT = 30;
const FX_RATE_WINDOW_MS = 10000;
const FX_RATE_LIMIT = 12;
const MAX_MAIN_STROKES = 32;
const MAX_MAIN_POINTS_PER_STROKE = 128;
const MAX_MAIN_TOTAL_POINTS = 2048;
const MAX_ENHANCEMENTS = 12;
const MAX_ENHANCEMENT_STROKES = 12;
const MAX_ENHANCEMENT_POINTS_PER_STROKE = 64;
const MAX_ENHANCEMENT_TOTAL_POINTS = 384;
const MAX_LABEL_LENGTH = 160;

const pendingRequests = new Map();
const processedRequests = new Map();
const requestHistoryByUser = new Map();
const incomingRequestTimes = [];
const acceptedFxIds = new Map();
const acceptedFxTimes = [];
let castFxPresenter = async () => {};

class CastNetworkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CastNetworkError";
    this.code = code;
  }
}

function localize(key, fallback) {
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  if (foundry.utils?.randomID) return foundry.utils.randomID(32);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function errorForCode(code, fallback) {
  const key = `GG.Network.${code}`;
  return new CastNetworkError(code, localize(key, fallback ?? localize("GG.CastFailed", "Spell casting failed.")));
}

function actorPermissionLevel(actor, user) {
  if (!actor || !user) return 0;
  if (user.isGM) return 3;
  if (typeof actor.testUserPermission === "function") {
    try {
      if (actor.testUserPermission(user, "OWNER")) return 3;
    } catch (_error) {}
    try {
      const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER;
      if (ownerLevel !== undefined && actor.testUserPermission(user, ownerLevel)) return 3;
    } catch (_error) {}
  }
  const ownership = actor.ownership ?? {};
  return Number(ownership[user.id] ?? ownership.default ?? 0) || 0;
}

function ownsActor(actor, user) {
  return actorPermissionLevel(actor, user) >= 3;
}

function trimMap(map, maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, value] of map) {
    const timestamp = Number(value?.timestamp ?? value) || 0;
    if (timestamp < cutoff) map.delete(key);
  }
}

function checkRequestRate(userId) {
  const now = Date.now();
  const entries = (requestHistoryByUser.get(userId) ?? []).filter((timestamp) => now - timestamp < REQUEST_RATE_WINDOW_MS);
  if (entries.length >= REQUEST_RATE_LIMIT) return false;
  entries.push(now);
  requestHistoryByUser.set(userId, entries);
  return true;
}

function checkGlobalRequestRate() {
  const now = Date.now();
  while (incomingRequestTimes.length && now - incomingRequestTimes[0] >= REQUEST_RATE_WINDOW_MS) incomingRequestTimes.shift();
  if (incomingRequestTimes.length >= GLOBAL_REQUEST_RATE_LIMIT) return false;
  incomingRequestTimes.push(now);
  return true;
}

function checkFxRate() {
  const now = Date.now();
  while (acceptedFxTimes.length && now - acceptedFxTimes[0] >= FX_RATE_WINDOW_MS) acceptedFxTimes.shift();
  if (acceptedFxTimes.length >= FX_RATE_LIMIT) return false;
  acceptedFxTimes.push(now);
  return true;
}

function samplePoints(points, maximum) {
  if (points.length <= maximum) return points;
  if (maximum <= 2) return [points[0], points.at(-1)].slice(0, maximum);
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_unused, index) => points[Math.round(index * step)]);
}

function sanitizeNormalizedStrokes(strokes, {
  maxStrokes,
  maxPointsPerStroke,
  maxTotalPoints,
  rejectOverflow = false
}) {
  if (!Array.isArray(strokes)) throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  if (rejectOverflow && strokes.length > maxStrokes) throw errorForCode("DRAWING_TOO_COMPLEX", "The drawing is too complex to process.");
  const result = [];
  let totalPoints = 0;
  for (const rawStroke of strokes.slice(0, maxStrokes)) {
    if (!Array.isArray(rawStroke)) continue;
    const valid = rawStroke
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: clamp(Number(point.x), 0, 1), y: clamp(Number(point.y), 0, 1) }));
    if (valid.length < 2) continue;
    if (rejectOverflow && valid.length > maxPointsPerStroke) throw errorForCode("DRAWING_TOO_COMPLEX", "The drawing is too complex to process.");
    const remaining = maxTotalPoints - totalPoints;
    if (remaining < 2) {
      if (rejectOverflow) throw errorForCode("DRAWING_TOO_COMPLEX", "The drawing is too complex to process.");
      break;
    }
    const sampled = samplePoints(valid, Math.min(maxPointsPerStroke, remaining));
    if (sampled.length < 2) continue;
    result.push(sampled);
    totalPoints += sampled.length;
  }
  if (rejectOverflow && totalPoints > maxTotalPoints) throw errorForCode("DRAWING_TOO_COMPLEX", "The drawing is too complex to process.");
  return result;
}

function packStrokes(strokes, limits) {
  return sanitizeNormalizedStrokes(strokes, { ...limits, rejectOverflow: false })
    .map((stroke) => stroke.flatMap((point) => [
      Math.round(clamp(point.x, 0, 1) * 10000),
      Math.round(clamp(point.y, 0, 1) * 10000)
    ]));
}

function unpackStrokes(packed, limits) {
  if (!Array.isArray(packed) || packed.length > limits.maxStrokes) {
    throw errorForCode("DRAWING_TOO_COMPLEX", "The drawing is too complex to process.");
  }
  let totalPoints = 0;
  const strokes = [];
  for (const entry of packed) {
    if (!Array.isArray(entry) || entry.length % 2 || entry.length / 2 > limits.maxPointsPerStroke) {
      throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
    }
    const points = [];
    for (let index = 0; index < entry.length; index += 2) {
      const x = Number(entry[index]);
      const y = Number(entry[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 10000 || y < 0 || y > 10000) {
        throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
      }
      points.push({ x: x / 10000, y: y / 10000 });
    }
    if (points.length >= 2) {
      totalPoints += points.length;
      if (totalPoints > limits.maxTotalPoints) throw errorForCode("DRAWING_TOO_COMPLEX", "The drawing is too complex to process.");
      strokes.push(points);
    }
  }
  return strokes;
}

const MAIN_LIMITS = {
  maxStrokes: MAX_MAIN_STROKES,
  maxPointsPerStroke: MAX_MAIN_POINTS_PER_STROKE,
  maxTotalPoints: MAX_MAIN_TOTAL_POINTS
};

const ENHANCEMENT_LIMITS = {
  maxStrokes: MAX_ENHANCEMENT_STROKES,
  maxPointsPerStroke: MAX_ENHANCEMENT_POINTS_PER_STROKE,
  maxTotalPoints: MAX_ENHANCEMENT_TOTAL_POINTS
};

function encodeEnhancements(enhancements) {
  if (!Array.isArray(enhancements)) return [];
  return enhancements.slice(0, MAX_ENHANCEMENTS).map((strokes) => packStrokes(strokes, ENHANCEMENT_LIMITS));
}

function decodeEnhancements(enhancements) {
  if (!Array.isArray(enhancements) || enhancements.length > MAX_ENHANCEMENTS) {
    throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  }
  return enhancements.map((packed) => unpackStrokes(packed, ENHANCEMENT_LIMITS)).filter((strokes) => strokes.length);
}

async function resolveActor(uuid) {
  if (typeof uuid !== "string" || uuid.length > 200) return null;
  if (globalThis.fromUuid) {
    try {
      const document = await fromUuid(uuid);
      if (document?.documentName === "Actor" || document?.constructor?.metadata?.name === "Actor") return document;
    } catch (_error) {}
  }
  const id = uuid.startsWith("Actor.") ? uuid.slice(6) : uuid;
  return game.actors?.get?.(id) ?? null;
}

function validateBaseRequest(data) {
  if (!data || data.protocol !== PROTOCOL_VERSION || data.type !== "castRequest") {
    throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  }
  if (typeof data.requestId !== "string" || data.requestId.length < 12 || data.requestId.length > 100) {
    throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  }
  if (
    typeof data.requesterId !== "string" || data.requesterId.length > 100
    || typeof data.gmId !== "string" || data.gmId.length > 100
    || typeof data.actorUuid !== "string" || data.actorUuid.length > 200
    || typeof data.spellId !== "string" || data.spellId.length > 100
  ) throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  const age = Math.abs(Date.now() - Number(data.createdAt));
  if (!Number.isFinite(age) || age > REQUEST_MAX_AGE_MS) throw errorForCode("REQUEST_EXPIRED", "The casting request expired.");
}

function makeFxPayload({ data, actor, spell, result, chance, forcedChance, drawnStrokes, enhancements }) {
  return {
    protocol: PROTOCOL_VERSION,
    type: "castFx",
    requestId: data.requestId,
    gmId: data.gmId,
    actorName: String(actor.name ?? "").slice(0, MAX_LABEL_LENGTH),
    spellName: String(spell.name ?? "").replace(/^\s*\d+\s*[-–—:]\s*/, "").slice(0, MAX_LABEL_LENGTH),
    powerLevel: result.powerLevel,
    mishap: Boolean(result.mishap),
    mishapUnits: result.mishapUnits,
    mishapSeverity: result.mishapSeverity,
    chance,
    forcedChance,
    sigil: {
      seed: `${spellSigilSeed(actor, spell)}:cast`,
      strokes: packStrokes(drawnStrokes, MAIN_LIMITS)
    },
    enhancements: encodeEnhancements(enhancements)
  };
}

async function executeValidatedRequest(data, { local = false, actorHint = null } = {}) {
  validateBaseRequest(data);
  if (!checkGlobalRequestRate()) throw errorForCode("RATE_LIMIT", "Too many casting requests. Try again in a moment.");
  trimMap(processedRequests, REQUEST_MAX_AGE_MS * 2);
  if (processedRequests.has(data.requestId)) throw errorForCode("REQUEST_REPLAY", "This casting request was already processed.");

  const authoritativeGm = activeAuthoritativeGm();
  const localRequester = Boolean(local && data.requesterId === game.user?.id);
  if (!localRequester && (!game.user?.isGM || authoritativeGm?.id !== game.user.id || data.gmId !== game.user.id)) {
    throw errorForCode("NOT_AUTHORITY", "This client is not the authoritative GM.");
  }

  const requester = game.users?.get?.(data.requesterId) ?? (localRequester ? game.user : null);
  if (!requester?.active) throw errorForCode("REQUESTER_OFFLINE", "The casting user is no longer connected.");
  if (!checkRequestRate(requester.id)) throw errorForCode("RATE_LIMIT", "Too many casting requests. Try again in a moment.");
  processedRequests.set(data.requestId, { timestamp: Date.now() });

  const actor = actorHint?.uuid === data.actorUuid ? actorHint : await resolveActor(data.actorUuid);
  if (!actor || actor.type !== "character" || !isMiracleWorker(actor)) {
    throw errorForCode("INVALID_ACTOR", "The miracle worker could not be resolved.");
  }
  if (!ownsActor(actor, requester)) throw errorForCode("NOT_OWNER", "The casting user does not own this actor.");

  const spell = actor.items?.get?.(data.spellId);
  if (!spell || spell.type !== "spell") throw errorForCode("INVALID_SPELL", "The spell could not be resolved.");

  const drawnStrokes = unpackStrokes(data.sigil?.strokes, MAIN_LIMITS);
  const enhancements = decodeEnhancements(data.enhancements);
  const target = normalizeSigilForDisplay(createSpellSigil(spellSigilSeed(actor, spell), spell.system.rank));
  const recognition = compareDrawingToSigil(drawnStrokes, target, { tolerance: 0.06 });
  if (!recognition.complete) throw errorForCode("SIGIL_INCOMPLETE", "Every element of the sigil must be traced.");
  if (recognition.score < SPELL_BIND_MIN_SIMILARITY) {
    throw errorForCode("SIGIL_TOO_IMPRECISE", "The sigil must reach at least 75% similarity.");
  }

  const autoDraw = Boolean(data.options?.autoDraw);
  const perfectBonus = autoDraw ? 0 : (recognition.perfectEligible && recognition.score > PERFECT_SIGIL_SIMILARITY ? 1 : 0);
  const spentWillpower = 1 + enhancements.length;
  const psychicPower = Boolean(data.options?.psychicPower) && hasPsychicPower(actor);
  const forcedChance = requiresChanceCasting(actor, spell);
  const chance = forcedChance || Boolean(data.options?.chance);
  const safeMaximum = spentWillpower + (psychicPower ? 1 : 0);
  const safeCast = chance ? 0 : clamp(integer(data.options?.safeCast), 0, safeMaximum);
  const ingredient = Boolean(data.options?.ingredient);

  const similarity = Math.round(recognition.score * 100);
  const auditBase = {
    protocol: PROTOCOL_VERSION,
    requestId: data.requestId,
    requesterId: requester.id,
    gmId: data.gmId,
    actorUuid: actor.uuid,
    spellId: spell.id,
    similarity,
    complete: recognition.complete,
    perfectEligible: recognition.perfectEligible,
    bonusPowerLevel: perfectBonus,
    spentWillpower,
    ingredient,
    chance,
    forcedChance,
    psychicPower,
    safeCast,
    autoDraw
  };

  let castResult;
  let fxPayload = null;
  try {
    castResult = await castSpellFromGrimoire({
      actor,
      spell,
      spentWillpower,
      ingredient,
      chance,
      psychicPower,
      safeCast,
      bonusPowerLevel: perfectBonus,
      messageDataFactory: (resolved) => {
        fxPayload = makeFxPayload({
          data,
          actor,
          spell,
          result: resolved,
          chance,
          forcedChance,
          drawnStrokes,
          enhancements
        });
        return {
          flags: {
            [MODULE_ID]: {
              castAudit: {
                ...auditBase,
                rolledOnes: resolved.rolledOnes,
                mishapUnits: resolved.mishapUnits,
                mishapSeverity: resolved.mishapSeverity,
                mishap: Boolean(resolved.mishap),
                createdAt: Date.now()
              },
              castFx: fxPayload
            }
          }
        };
      }
    });
  } catch (error) {
    if (/willpower/i.test(String(error?.message))) throw errorForCode("NOT_ENOUGH_WP", "Not enough Willpower Points.");
    throw error;
  }

  fxPayload ??= makeFxPayload({
    data,
    actor,
    spell,
    result: castResult,
    chance,
    forcedChance,
    drawnStrokes,
    enhancements
  });

  return {
    result: {
      powerLevel: castResult.powerLevel,
      spellDice: castResult.spellDice,
      spentWillpower: castResult.spentWillpower,
      bonusPowerLevel: perfectBonus,
      similarity,
      rolledOnes: castResult.rolledOnes,
      mishapUnits: castResult.mishapUnits,
      mishapSeverity: castResult.mishapSeverity,
      mishap: Boolean(castResult.mishap),
      chance,
      forcedChance,
      messageId: castResult.message?.id ?? null
    },
    fxPayload,
    postCastTask: castResult.mishap
      ? () => drawConfiguredMishapTable({ actor, level: castResult.mishapSeverity, targetName: spell.name, context: "cast" })
      : null
  };
}

function sendSocket(data) {
  if (!game.socket?.emit) throw errorForCode("SOCKET_UNAVAILABLE", "The Foundry socket is unavailable.");
  game.socket.emit(`module.${MODULE_ID}`, data);
}

function schedulePostCastTask(task) {
  if (typeof task !== "function") return;
  const run = () => {
    window.setTimeout(() => {
      void Promise.resolve().then(task).catch((error) => {
        console.warn("Goetia Grimoire | Deferred post-cast task failed.", error);
      });
    }, 120);
  };
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
  else run();
}

async function processRemoteRequest(data) {
  let response;
  let fxPayload = null;
  let postCastTask = null;
  try {
    const execution = await executeValidatedRequest(data);
    fxPayload = execution.fxPayload;
    postCastTask = execution.postCastTask;
    response = {
      protocol: PROTOCOL_VERSION,
      type: "castResult",
      requestId: data.requestId,
      requesterId: data.requesterId,
      gmId: game.user.id,
      ok: true,
      result: execution.result
    };
  } catch (error) {
    if (error instanceof CastNetworkError) console.debug(`Goetia Grimoire | Cast rejected: ${error.code}`);
    else console.error("Goetia Grimoire | Authoritative cast failed.", error);
    response = {
      protocol: PROTOCOL_VERSION,
      type: "castResult",
      requestId: data?.requestId,
      requesterId: data?.requesterId,
      gmId: game.user.id,
      ok: false,
      errorCode: error?.code ?? "CAST_FAILED"
    };
  }
  try {
    sendSocket(response);
  } catch (error) {
    console.error("Goetia Grimoire | Unable to return authoritative cast result.", error);
  }
  if (fxPayload) await publishCastFx(fxPayload);
  if (postCastTask) schedulePostCastTask(postCastTask);
}

function decodeFxPayload(data) {
  if (!data || data.protocol !== PROTOCOL_VERSION || data.type !== "castFx") {
    throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  }
  if (
    typeof data.requestId !== "string" || data.requestId.length < 12 || data.requestId.length > 100
    || typeof data.gmId !== "string" || data.gmId.length > 100
  ) throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  const actorName = String(data.actorName ?? "").slice(0, MAX_LABEL_LENGTH);
  const spellName = String(data.spellName ?? "").slice(0, MAX_LABEL_LENGTH);
  const powerLevel = integer(data.powerLevel, 0);
  const mishapUnits = integer(data.mishapUnits, 0);
  const mishapSeverity = integer(data.mishapSeverity, 0);
  if (
    powerLevel < 0 || powerLevel > 100
    || mishapUnits < 0 || mishapUnits > 100
    || mishapSeverity < 0 || mishapSeverity > 6
  ) throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  const seed = String(data.sigil?.seed ?? "cast").slice(0, 240);
  return {
    requestId: data.requestId,
    gmId: data.gmId,
    actorName,
    spellName,
    powerLevel,
    mishap: Boolean(data.mishap),
    mishapUnits,
    mishapSeverity,
    chance: Boolean(data.chance),
    forcedChance: Boolean(data.forcedChance),
    sigil: { seed, strokes: unpackStrokes(data.sigil?.strokes, MAIN_LIMITS) },
    enhancements: decodeEnhancements(data.enhancements)
  };
}

function decodeCastResult(data) {
  if (!data?.ok || !data.result || typeof data.result !== "object") {
    throw errorForCode("INVALID_RESPONSE", "The GM returned an invalid casting response.");
  }
  const powerLevel = integer(data.result.powerLevel, -1);
  const spellDice = integer(data.result.spellDice, -1);
  const spentWillpower = integer(data.result.spentWillpower, -1);
  const bonusPowerLevel = integer(data.result.bonusPowerLevel, -1);
  const similarity = integer(data.result.similarity, -1);
  const rolledOnes = integer(data.result.rolledOnes, -1);
  const mishapUnits = integer(data.result.mishapUnits, -1);
  const mishapSeverity = integer(data.result.mishapSeverity, -1);
  if (
    powerLevel < 0 || powerLevel > 100
    || spellDice < 0 || spellDice > 100
    || spentWillpower < 1 || spentWillpower > MAX_ENHANCEMENTS + 1
    || bonusPowerLevel < 0 || bonusPowerLevel > 1
    || similarity < 0 || similarity > 100
    || rolledOnes < 0 || rolledOnes > spellDice
    || mishapUnits < 0 || mishapUnits > 100
    || mishapSeverity < 0 || mishapSeverity > 6
  ) throw errorForCode("INVALID_RESPONSE", "The GM returned an invalid casting response.");
  const messageId = data.result.messageId == null ? null : String(data.result.messageId).slice(0, 100);
  return {
    powerLevel,
    spellDice,
    spentWillpower,
    bonusPowerLevel,
    similarity,
    rolledOnes,
    mishapUnits,
    mishapSeverity,
    mishap: Boolean(data.result.mishap),
    chance: Boolean(data.result.chance),
    forcedChance: Boolean(data.result.forcedChance),
    messageId
  };
}

async function presentCastFxOnce(payload) {
  const decoded = decodeFxPayload(payload);
  trimMap(acceptedFxIds, REQUEST_MAX_AGE_MS * 2);
  if (acceptedFxIds.has(decoded.requestId)) return false;
  if (!checkFxRate()) return false;
  acceptedFxIds.set(decoded.requestId, { timestamp: Date.now() });
  await castFxPresenter(decoded);
  return true;
}

async function publishCastFx(payload) {
  try {
    sendSocket(payload);
  } catch (error) {
    console.warn("Goetia Grimoire | Unable to broadcast cast effect.", error);
  }
  try {
    await presentCastFxOnce(payload);
  } catch (error) {
    console.warn("Goetia Grimoire | Unable to present local cast effect.", error);
  }
}

export function setCastFxPresenter(presenter) {
  castFxPresenter = typeof presenter === "function" ? presenter : async () => {};
}

export async function handleCastChatMessage(message) {
  const moduleFlags = message?.flags?.[MODULE_ID] ?? message?.getFlag?.(MODULE_ID, "") ?? null;
  const audit = moduleFlags?.castAudit;
  const payload = moduleFlags?.castFx;
  if (!audit || !payload || audit.requestId !== payload.requestId) return;
  try {
    await presentCastFxOnce(payload);
  } catch (error) {
    console.warn("Goetia Grimoire | Rejected malformed ChatMessage cast effect.", error);
  }
}

export async function requestAuthoritativeCast({
  actor,
  spell,
  ingredient = false,
  chance = false,
  psychicPower = false,
  safeCast = 0,
  autoDraw = false,
  sigilStrokes = [],
  enhancements = []
}) {
  const gm = activeAuthoritativeGm();
  if (!actor?.uuid || !spell?.id) throw errorForCode("INVALID_REQUEST", "Invalid casting request.");
  if (!ownsActor(actor, game.user)) throw errorForCode("NOT_OWNER", "The casting user does not own this actor.");

  if (Array.isArray(enhancements) && enhancements.length > MAX_ENHANCEMENTS) {
    throw errorForCode("TOO_MANY_ENHANCEMENTS", "Too many enhancement marks were supplied.");
  }

  const requestId = randomId();
  const request = {
    protocol: PROTOCOL_VERSION,
    type: "castRequest",
    requestId,
    requesterId: game.user.id,
    gmId: gm?.id ?? game.user.id,
    createdAt: Date.now(),
    actorUuid: actor.uuid,
    spellId: spell.id,
    options: {
      ingredient: Boolean(ingredient),
      chance: Boolean(chance),
      psychicPower: Boolean(psychicPower),
      safeCast: integer(safeCast),
      autoDraw: Boolean(autoDraw)
    },
    sigil: { strokes: packStrokes(sigilStrokes, MAIN_LIMITS) },
    enhancements: encodeEnhancements(enhancements)
  };

  const execution = await executeValidatedRequest(request, { local: true, actorHint: actor });
  await publishCastFx(execution.fxPayload);
  if (execution.postCastTask) schedulePostCastTask(execution.postCastTask);
  return execution.result;
}

export async function handleCastSocketMessage(data) {
  if (!data || data.protocol !== PROTOCOL_VERSION) return;

  if (data.type === "castRequest") {
    const gm = activeAuthoritativeGm();
    if (!game.user?.isGM || gm?.id !== game.user.id || data.gmId !== game.user.id) return;
    await processRemoteRequest(data);
    return;
  }

  if (data.type === "castResult") {
    if (data.requesterId !== game.user.id) return;
    const pending = pendingRequests.get(data.requestId);
    if (!pending || pending.gmId !== data.gmId) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(data.requestId);
    if (data.ok) {
      try {
        pending.resolve(decodeCastResult(data));
      } catch (error) {
        pending.reject(error);
      }
    } else pending.reject(errorForCode(data.errorCode ?? "CAST_FAILED"));
    return;
  }

  if (data.type === "castFx") {
    try {
      await presentCastFxOnce(data);
    } catch (error) {
      console.warn("Goetia Grimoire | Rejected malformed cast effect.", error);
    }
  }
}
