function configuredRollClasses() {
  const collection = globalThis.CONFIG?.Dice?.rolls;
  const classes = Array.isArray(collection)
    ? collection
    : collection && typeof collection === "object"
      ? Object.values(collection)
      : [];
  const configuredIndex = Number(globalThis.CONFIG?.YZUR?.ROLL?.index);
  const configured = Number.isInteger(configuredIndex) ? collection?.[configuredIndex] : null;
  return [configured, ...classes].filter(Boolean);
}

export function getYearZeroRollClass(message = "Forbidden Lands roll class is unavailable.") {
  const RollClass = configuredRollClasses().find((candidate) => typeof candidate?.forge === "function");
  if (!RollClass) throw new Error(message);
  return RollClass;
}

export async function evaluateYearZeroRoll(roll, message = "Forbidden Lands roll cannot be evaluated.") {
  if (!roll) throw new Error(message);
  if (roll.dice?.length && typeof roll.roll === "function") {
    await roll.roll();
    return roll;
  }
  if (typeof roll.evaluate === "function") {
    await roll.evaluate();
    return roll;
  }
  if (typeof roll.roll === "function") {
    await roll.roll();
    return roll;
  }
  throw new Error(message);
}

function numericProperty(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function dieDenomination(die) {
  return String(
    die?.denomination
    ?? die?.constructor?.DENOMINATION
    ?? die?.options?.denomination
    ?? ""
  ).toLocaleLowerCase("en-US");
}

export function yearZeroSuccesses(roll) {
  const direct = numericProperty(roll, ["successCount", "successes", "success"]);
  if (direct != null) return Math.max(0, Math.floor(direct));

  const total = numericProperty(roll, ["total"]);
  if (total != null) return Math.max(0, Math.floor(total));

  let successes = 0;
  let negativeSuccesses = 0;
  for (const die of roll?.dice ?? []) {
    const hits = (die?.results ?? []).filter((result) => (
      result?.active !== false
      && !result?.discarded
      && Number(result?.result) >= 6
    )).length;
    if (dieDenomination(die) === "n") negativeSuccesses += hits;
    else successes += hits;
  }
  return Math.max(0, successes - negativeSuccesses);
}


export function yearZeroOnes(roll, { denominations = ["b"] } = {}) {
  const accepted = denominations == null ? null : new Set(denominations.map((value) => String(value).toLocaleLowerCase("en-US")));
  let ones = 0;
  for (const die of roll?.dice ?? []) {
    if (accepted && !accepted.has(dieDenomination(die))) continue;
    for (const result of die?.results ?? []) {
      if (result?.active === false || result?.discarded) continue;
      if (Number(result?.result) === 1) ones += 1;
    }
  }
  return ones;
}
