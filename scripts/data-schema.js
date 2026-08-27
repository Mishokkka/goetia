import { MODULE_ID, isMagicTalent, isMiracleWorker } from "./config.js";
import { createUnlockSigil, UNLOCK_SIGIL_VERSION } from "./sigil.js";
import { isAuthoritativeGm } from "./user-authority.js";

export const CURRENT_DATA_SCHEMA = 5;

function actorModuleFlags(actor) {
  const flags = actor?.flags?.[MODULE_ID];
  return flags && typeof flags === "object" && !Array.isArray(flags) ? flags : {};
}

export function shouldMigrateActorAfterItemCreate(actor, item) {
  if (!actor || actor.type !== "character" || !item) return false;

  // A newly created magic talent can make an otherwise irrelevant actor a
  // miracle worker for the first time, so it must still receive module data.
  if (isMagicTalent(item)) return true;

  const flags = actorModuleFlags(actor);
  if (!Object.keys(flags).length) return false;

  // Item creation cannot make existing keyed spell flags stale. Only run the
  // full migration here when non-item schema data itself is actually stale.
  if (Number(flags.schemaVersion) !== CURRENT_DATA_SCHEMA) return true;
  if (flags.contractHtml != null && typeof flags.contractHtml !== "string") return true;
  if (!flags.unlockSigil?.strokes?.length || Number(flags.unlockSigil?.version) < UNLOCK_SIGIL_VERSION) return true;
  return false;
}

function clone(value) {
  return foundry.utils?.deepClone ? foundry.utils.deepClone(value) : structuredClone(value);
}

function spellIds(actor) {
  return new Set((actor.items ?? []).filter((item) => item.type === "spell").map((item) => item.id));
}

function cleanKeyedFlag(value, validIds) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? clone(value) : {};
  let changed = false;
  for (const key of Object.keys(source)) {
    if (validIds.has(key)) continue;
    delete source[key];
    changed = true;
  }
  return { value: source, changed };
}

export async function migrateActorData(actor) {
  if (!actor || actor.type !== "character") return false;
  const flags = actorModuleFlags(actor);
  const relevant = Object.keys(flags).length > 0 || isMiracleWorker(actor);
  if (!relevant) return false;

  const validIds = spellIds(actor);
  const positions = cleanKeyedFlag(flags.spellPositions, validIds);
  const salts = cleanKeyedFlag(flags.spellSigilSalts, validIds);
  const update = {};

  if (positions.changed) update[`flags.${MODULE_ID}.spellPositions`] = positions.value;
  if (salts.changed) update[`flags.${MODULE_ID}.spellSigilSalts`] = salts.value;
  if (flags.contractHtml != null && typeof flags.contractHtml !== "string") {
    update[`flags.${MODULE_ID}.contractHtml`] = String(flags.contractHtml ?? "");
  }
  if (!flags.unlockSigil?.strokes?.length || Number(flags.unlockSigil?.version) < UNLOCK_SIGIL_VERSION) {
    update[`flags.${MODULE_ID}.unlockSigil`] = createUnlockSigil(`${actor.uuid}:${actor.name}`);
  }
  if (Number(flags.schemaVersion) !== CURRENT_DATA_SCHEMA) {
    update[`flags.${MODULE_ID}.schemaVersion`] = CURRENT_DATA_SCHEMA;
  }

  if (!Object.keys(update).length) return false;
  await actor.update(update, { render: false, diff: true });
  return true;
}

export async function cleanupDeletedSpell(item) {
  if (!item || item.type !== "spell" || !item.parent || item.parent.documentName !== "Actor") return;
  const actor = item.parent;
  const positions = clone(actor.getFlag(MODULE_ID, "spellPositions") ?? {});
  const salts = clone(actor.getFlag(MODULE_ID, "spellSigilSalts") ?? {});
  let changed = false;
  if (Object.hasOwn(positions, item.id)) {
    delete positions[item.id];
    changed = true;
  }
  if (Object.hasOwn(salts, item.id)) {
    delete salts[item.id];
    changed = true;
  }
  if (!changed) return;
  await actor.update({
    [`flags.${MODULE_ID}.spellPositions`]: positions,
    [`flags.${MODULE_ID}.spellSigilSalts`]: salts
  }, { render: false, diff: true });
}

export function registerDataSchemaSettings() {
  game.settings.register(MODULE_ID, "dataSchemaVersion", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

export async function runWorldMigrations() {
  if (!isAuthoritativeGm()) return;
  const stored = Number(game.settings.get(MODULE_ID, "dataSchemaVersion") ?? 0);
  if (stored >= CURRENT_DATA_SCHEMA) return;

  let migrated = 0;
  let failures = 0;
  for (const actor of game.actors ?? []) {
    try {
      if (await migrateActorData(actor)) migrated += 1;
    } catch (error) {
      failures += 1;
      console.error(`Goetia Grimoire | Actor migration failed for ${actor?.name ?? actor?.id}.`, error);
    }
  }
  if (failures > 0) {
    console.warn(`Goetia Grimoire | Data schema ${CURRENT_DATA_SCHEMA} remains pending after ${failures} actor migration failure(s).`);
    return;
  }
  await game.settings.set(MODULE_ID, "dataSchemaVersion", CURRENT_DATA_SCHEMA);
  console.log(`Goetia Grimoire | Data schema ${CURRENT_DATA_SCHEMA} applied to ${migrated} actors.`);
}
