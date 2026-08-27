import { evaluateYearZeroRoll, getYearZeroRollClass, yearZeroOnes } from "./year-zero-roll.js";
import { normalizeMishapLevel } from "./mishap-service.js";

const castQueueByActor = new Map();

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

async function performCastSpell({
  actor,
  spell,
  spentWillpower,
  ingredient = false,
  chance = false,
  psychicPower = false,
  safeCast = 0,
  bonusPowerLevel = 0,
  messageDataFactory = null
}) {
  if (!game.user?.isGM) throw new Error("Only an active GM may resolve grimoire casts.");
  if (!actor?.isOwner) throw new Error("The current user does not own this actor.");
  if (!spell || spell.type !== "spell") throw new Error("Invalid spell.");

  const currentWillpower = nonNegativeInteger(actor.system?.bio?.willpower?.value);
  const spent = Math.max(1, nonNegativeInteger(spentWillpower, 1));
  if (currentWillpower < spent) throw new Error("Not enough Willpower Points.");

  const basePower = spent;
  const psychic = psychicPower ? 1 : 0;
  const safe = Math.min(nonNegativeInteger(safeCast), basePower + psychic);
  const spellDice = Math.max(0, basePower + psychic - safe);
  const bonusPower = nonNegativeInteger(bonusPowerLevel);
  const powerLevel = spellDice + safe + (ingredient ? 1 : 0) + bonusPower;
  const speaker = ChatMessage.getSpeaker({ actor });
  const RollClass = getYearZeroRollClass();

  const options = {
    name: spell.name,
    title: spell.name,
    type: "spell",
    actorId: speaker.actor ?? actor.id,
    actorType: actor.type,
    alias: speaker.alias ?? actor.name,
    tokenId: speaker.token ?? null,
    sceneId: speaker.scene ?? null,
    itemId: spell.id,
    chance: Boolean(chance),
    damage: powerLevel,
    maxPush: "0",
    mishapTable: null,
    mishapType: "spell",
    yzGame: CONFIG.YZUR?.game
  };

  const remainingWillpower = currentWillpower - spent;
  let deducted = false;
  try {
    await actor.update({ "system.bio.willpower.value": remainingWillpower }, { render: false });
    deducted = true;

    const roll = RollClass.forge(
      [{ term: "b", number: spellDice, flavor: spell.name }],
      { yzGame: CONFIG.YZUR?.game, maxPush: 0, title: spell.name },
      options
    );

    await evaluateYearZeroRoll(roll, "Forbidden Lands spell roll cannot be evaluated.");
    const rolledOnes = yearZeroOnes(roll, { denominations: ["b"] });
    const mishapUnits = rolledOnes + (chance ? 1 : 0);
    const mishapSeverity = mishapUnits > 0 ? normalizeMishapLevel(mishapUnits) : 0;
    const result = {
      roll,
      message: null,
      spellDice,
      powerLevel,
      spentWillpower: spent,
      bonusPowerLevel: bonusPower,
      rolledOnes,
      mishapUnits,
      mishapSeverity,
      mishap: mishapUnits > 0
    };
    if (typeof roll.toMessage !== "function") throw new Error("Forbidden Lands spell roll cannot create a chat message.");
    const messageData = typeof messageDataFactory === "function" ? (messageDataFactory(result) ?? {}) : {};
    result.message = await roll.toMessage(messageData);
    return result;
  } catch (error) {
    const liveWillpower = nonNegativeInteger(actor.system?.bio?.willpower?.value);
    if (deducted && liveWillpower === remainingWillpower) {
      await actor.update({ "system.bio.willpower.value": currentWillpower }, { render: false }).catch(() => {});
    }
    throw error;
  }
}


export function castSpellFromGrimoire(options) {
  const actorKey = options?.actor?.uuid ?? options?.actor?.id;
  if (!actorKey) return Promise.reject(new Error("Invalid actor."));
  const previous = castQueueByActor.get(actorKey) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(() => performCastSpell(options));
  const queueTail = task.catch(() => {}).finally(() => {
    if (castQueueByActor.get(actorKey) === queueTail) castQueueByActor.delete(actorKey);
  });
  castQueueByActor.set(actorKey, queueTail);
  return task;
}
