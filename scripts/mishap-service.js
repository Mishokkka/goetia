import { MODULE_ID } from "./config.js";

const MIN_MISHAP_LEVEL = 0;
const MAX_MISHAP_LEVEL = 6;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function localize(key, fallback = key) {
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}

function collectionContents(collection) {
  if (!collection) return [];
  if (Array.isArray(collection.contents)) return collection.contents;
  try {
    return Array.from(collection);
  } catch (_error) {
    return [];
  }
}

export function normalizeMishapLevel(value) {
  return clamp(integer(value), MIN_MISHAP_LEVEL, MAX_MISHAP_LEVEL);
}

export function mishapTableSetting(level) {
  return `mishapTable${normalizeMishapLevel(level)}`;
}

export function configuredMishapTable(level) {
  const normalized = normalizeMishapLevel(level);
  try {
    const id = String(game.settings.get(MODULE_ID, mishapTableSetting(normalized)) ?? "").trim();
    return id ? game.tables?.get?.(id) ?? null : null;
  } catch (_error) {
    return null;
  }
}

export async function drawConfiguredMishapTable({ actor = null, level, targetName = "", context = "cast" } = {}) {
  const normalized = normalizeMishapLevel(level);
  const table = configuredMishapTable(normalized);
  if (table?.draw) {
    try {
      return await table.draw({ displayChat: true });
    } catch (error) {
      console.warn(`Goetia Grimoire | Mishap table ${normalized} could not be drawn.`, error);
    }
  }

  const speaker = actor ? ChatMessage.getSpeaker({ actor }) : undefined;
  const levelLabel = normalized === MAX_MISHAP_LEVEL ? `${normalized}+` : String(normalized);
  const contextLabel = context === "training"
    ? localize("GG.MishapContextTraining", "Training mishap")
    : localize("GG.MishapContextCast", "Spell mishap");
  await ChatMessage.create({
    ...(speaker ? { speaker } : {}),
    content: `<div class="gg-training-chat"><h3>${escapeHtml(contextLabel)}</h3><p>${escapeHtml(targetName)}${targetName ? ": " : ""}<b>${escapeHtml(levelLabel)}</b></p><p>${escapeHtml(localize("GG.MishapLevelTableMissing", "No RollTable is configured for this mishap level."))}</p></div>`
  }).catch((error) => console.warn("Goetia Grimoire | Unable to report missing mishap table.", error));
  return null;
}

function settingsContext() {
  const tables = collectionContents(game.tables)
    .map((table) => ({ id: String(table?.id ?? ""), name: String(table?.name ?? "") }))
    .filter((table) => table.id)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n?.lang));

  return {
    levels: Array.from({ length: MAX_MISHAP_LEVEL + 1 }, (_unused, level) => {
      const selectedId = String(game.settings.get(MODULE_ID, mishapTableSetting(level)) ?? "");
      return {
        level,
        label: level === MAX_MISHAP_LEVEL ? `${level}+` : String(level),
        hint: localize(`GG.Settings.MishapTable${level}Hint`, level === 0
          ? "Used only for spell-training mishaps of level 0."
          : `Used when a cast has ${level}${level === MAX_MISHAP_LEVEL ? " or more" : ""} mishap unit${level === 1 ? "" : "s"}.`),
        tables: tables.map((table) => ({ ...table, selected: table.id === selectedId }))
      };
    })
  };
}

async function saveSettings(formData) {
  const values = formData instanceof FormData ? formData : new FormData(formData);
  for (let level = MIN_MISHAP_LEVEL; level <= MAX_MISHAP_LEVEL; level += 1) {
    await game.settings.set(MODULE_ID, mishapTableSetting(level), String(values.get(mishapTableSetting(level)) ?? "").trim());
  }
}

function reportSaveFailure(error) {
  console.error("Goetia Grimoire | Failed to save mishap table settings.", error);
  ui.notifications.error(localize("GG.Settings.SaveFailed", "Unable to save grimoire settings."));
}

function legacySettingsClass() {
  return class GGMishapSettingsLegacy extends FormApplication {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: `${MODULE_ID}-mishap-settings`,
        title: localize("GG.Settings.MishapMenu", "Mishap tables"),
        template: `modules/${MODULE_ID}/templates/mishap-settings.hbs`,
        width: 540,
        height: "auto",
        closeOnSubmit: true,
        submitOnChange: false
      });
    }

    getData() {
      return settingsContext();
    }

    async _updateObject(_event, formData) {
      const data = new FormData();
      for (const [key, value] of Object.entries(formData)) data.set(key, value);
      try {
        await saveSettings(data);
      } catch (error) {
        reportSaveFailure(error);
        throw error;
      }
    }
  };
}

function applicationV2SettingsClass() {
  const api = foundry.applications?.api;
  if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) return null;
  const Base = api.HandlebarsApplicationMixin(api.ApplicationV2);
  return class GGMishapSettingsV2 extends Base {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-mishap-settings`,
      tag: "form",
      position: { width: 540, height: 570 },
      window: { title: "GG.Settings.MishapMenu", icon: "fas fa-skull-crossbones" }
    };

    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/mishap-settings-v2.hbs` }
    };

    get title() {
      return localize("GG.Settings.MishapMenu", "Mishap tables");
    }

    async _prepareContext() {
      return settingsContext();
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const form = this.element;
      if (!form || form.dataset.ggSubmitBound === "true") return;
      form.dataset.ggSubmitBound = "true";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (this._ggSubmitting) return;
        this._ggSubmitting = true;
        const submitter = event.submitter;
        if (submitter) submitter.disabled = true;
        try {
          await saveSettings(new FormData(form));
          await this.close();
        } catch (error) {
          reportSaveFailure(error);
        } finally {
          this._ggSubmitting = false;
          if (submitter?.isConnected) submitter.disabled = false;
        }
      });
    }
  };
}

export function registerMishapSettings() {
  for (let level = MIN_MISHAP_LEVEL; level <= MAX_MISHAP_LEVEL; level += 1) {
    game.settings.register(MODULE_ID, mishapTableSetting(level), {
      name: `GG.Settings.MishapTable${level}`,
      hint: `GG.Settings.MishapTable${level}Hint`,
      scope: "world",
      config: false,
      type: String,
      default: ""
    });
  }

  const SettingsClass = applicationV2SettingsClass() ?? legacySettingsClass();
  game.settings.registerMenu(MODULE_ID, "mishapMenu", {
    name: "GG.Settings.MishapMenu",
    label: "GG.Settings.MishapMenuLabel",
    hint: "GG.Settings.MishapMenuHint",
    icon: "fas fa-skull-crossbones",
    type: SettingsClass,
    restricted: true
  });
}
