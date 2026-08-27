export const MODULE_ID = "goetia-grimoire";
export const SPELL_BIND_MIN_SIMILARITY = 0.75;
export const PERFECT_SIGIL_SIMILARITY = 0.91;

export const ITEM_ROLES = Object.freeze({
  MAGIC_TALENT: "magicTalent",
  PSYCHIC_POWER: "psychicPower"
});

export const MAGIC_TALENT_NAMES = new Set([
  "(d) path of healing",
  "(d) path of ice",
  "(d) path of nature",
  "(d) path of shifting shapes",
  "(d) path of sight",
  "(d) path of swarm",
  "(s) path of blood",
  "(s) path of death",
  "(s) path of elements",
  "(s) path of signs",
  "(s) path of stone",
  "(s/d) path of dreams",
  "(s/d) path of magma",
  "(s/d) path of magnetism",
  "(s/d) path of mentalism"
]);

const aliasCache = new Map();

const PSYCHIC_POWER_NAMES = new Set([
  "psychic power (half-elf)",
  "psychic power",
  "психическая сила (полуэльф)",
  "психическая сила"
]);

export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function itemRole(item) {
  try {
    return item?.getFlag?.(MODULE_ID, "role") ?? item?.flags?.[MODULE_ID]?.role ?? null;
  } catch (_error) {
    return item?.flags?.[MODULE_ID]?.role ?? null;
  }
}

function customAliases(settingName) {
  try {
    const raw = String(game.settings.get(MODULE_ID, settingName) ?? "");
    const cached = aliasCache.get(settingName);
    if (cached?.raw === raw) return cached.values;
    const values = new Set(raw.split(/[\n,;]+/).map(normalizeName).filter(Boolean));
    aliasCache.set(settingName, { raw, values });
    return values;
  } catch (_error) {
    return new Set();
  }
}

export function clearTalentAliasCache() {
  aliasCache.clear();
}

function stableItemIdentifiers(item) {
  return [
    item?.system?.identifier,
    item?.system?.slug,
    item?.system?.key,
    item?.flags?.core?.sourceId,
    item?.flags?.world?.identifier
  ].map(normalizeName).filter(Boolean);
}

export function isMagicTalent(item) {
  if (item?.type !== "talent") return false;
  const normalizedName = normalizeName(item.name);
  const professionType = normalizeName(item?.system?.type ?? item?.system?.category);
  if (professionType === "profession" && /^\((?:s|d|s\/d)\)\s+path\b/.test(normalizedName)) return true;
  if (itemRole(item) === ITEM_ROLES.MAGIC_TALENT || item?.flags?.[MODULE_ID]?.magicTalent === true) return true;
  if (MAGIC_TALENT_NAMES.has(normalizedName)) return true;
  const aliases = customAliases("magicTalentAliases");
  if (aliases.has(normalizeName(item.name))) return true;
  return stableItemIdentifiers(item).some((identifier) => identifier.includes("path-of-") || identifier.includes("path of "));
}

export function isMiracleWorker(actor) {
  if (actor?.getFlag?.(MODULE_ID, "forceMiracleWorker") === true) return true;
  return actor?.items?.some?.(isMagicTalent) ?? false;
}

export function hasPsychicPower(actor) {
  return actor?.items?.some?.((item) => {
    if (item?.type !== "talent") return false;
    if (itemRole(item) === ITEM_ROLES.PSYCHIC_POWER || item?.flags?.[MODULE_ID]?.psychicPower === true) return true;
    const name = normalizeName(item.name);
    if (PSYCHIC_POWER_NAMES.has(name)) return true;
    return customAliases("psychicPowerAliases").has(name);
  }) ?? false;
}

export function trainingSourceId(item) {
  try {
    return item?.getFlag?.(MODULE_ID, "trainingSourceId")
      ?? item?.flags?.[MODULE_ID]?.trainingSourceId
      ?? null;
  } catch (_error) {
    return item?.flags?.[MODULE_ID]?.trainingSourceId ?? null;
  }
}

export function spellSigilSeed(actor, spell) {
  let salts = actor?.flags?.[MODULE_ID]?.spellSigilSalts ?? {};
  try {
    salts = actor?.getFlag?.(MODULE_ID, "spellSigilSalts") ?? salts;
  } catch (_error) {}
  const salt = typeof salts?.[spell?.id] === "string" ? salts[spell.id] : "";
  const sourceId = trainingSourceId(spell);
  if (sourceId) return `${actor?.uuid}:training:${sourceId}:${salt}`;
  return `${actor?.uuid}:${spell?.id}:${salt}`;
}


export function spellDiscipline(spell) {
  return spell?.getFlag?.(MODULE_ID, "trainingDiscipline")
    ?? spell?.flags?.[MODULE_ID]?.trainingDiscipline
    ?? spell?.flags?.["spell-compendium-builder"]?.discipline
    ?? spell?.system?.discipline
    ?? null;
}

function magicTalentRank(item) {
  const value = Number(item?.system?.rank);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function castingTalentRank(actor, _spell = null) {
  const talents = actor?.items?.filter?.((item) => item?.type === "talent" && isMagicTalent(item)) ?? [];
  return talents.reduce((highest, item) => Math.max(highest, magicTalentRank(item)), 0);
}

export function requiresChanceCasting(actor, spell) {
  const spellRank = Math.max(0, Math.floor(Number(spell?.system?.rank) || 0));
  const talentRank = castingTalentRank(actor, spell);
  return spellRank > talentRank;
}
