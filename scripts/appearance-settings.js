import { MODULE_ID } from "./config.js";

const FONT_STYLE_ID = `${MODULE_ID}-font-face`;

function reportSettingsSaveFailure(error) {
  console.error("Goetia Grimoire | Failed to save appearance settings.", error);
  const key = "GG.Settings.SaveFailed";
  const message = game.i18n.localize(key);
  ui.notifications.error(message === key ? "Unable to save grimoire settings." : message);
}

function availableFonts() {
  const families = new Set(["Signika", "IM Fell English", "serif"]);
  try {
    const configured = game.settings?.get?.("core", "fonts");
    if (configured && typeof configured === "object") Object.keys(configured).forEach((name) => families.add(name));
  } catch (_error) {}
  try {
    Object.keys(CONFIG.fontDefinitions ?? {}).forEach((name) => families.add(name));
  } catch (_error) {}
  try {
    for (const face of document.fonts ?? []) {
      const family = String(face.family ?? "").replaceAll('"', "").trim();
      if (family) families.add(family);
    }
  } catch (_error) {}
  return [...families].sort((a, b) => a.localeCompare(b, game.i18n?.lang ?? "en"));
}

function settingsContext() {
  const storedMode = game.settings.get(MODULE_ID, "fontMode");
  return {
    mode: storedMode === "bundled" ? "foundry" : storedMode || "foundry",
    fontPath: game.settings.get(MODULE_ID, "fontPath") ?? "",
    fontFamily: game.settings.get(MODULE_ID, "fontFamily") ?? "Signika",
    fonts: availableFonts()
  };
}

async function saveFontSettings(data) {
  await game.settings.set(MODULE_ID, "fontMode", data.fontMode || "foundry");
  await game.settings.set(MODULE_ID, "fontPath", data.fontPath || "");
  await game.settings.set(MODULE_ID, "fontFamily", data.fontFamily || "Signika");
  installConfiguredFont();
}

function openFontPicker(input) {
  const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  if (!Picker || !input) return;
  const picker = new Picker({
    type: "font",
    current: input.value,
    callback: (path) => { input.value = path; }
  });
  picker.render(true);
}

export function installConfiguredFont() {
  document.getElementById(FONT_STYLE_ID)?.remove();
  const { mode, fontPath, fontFamily } = settingsContext();
  const style = document.createElement("style");
  style.id = FONT_STYLE_ID;
  let familyExpression = '"Signika", "IM Fell English", serif';

  if (mode === "custom" && fontPath) {
    const escaped = String(fontPath).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    style.textContent = `@font-face{font-family:"Goetia Grimoire Custom";src:url("${escaped}");font-display:swap;}`;
    familyExpression = '"Goetia Grimoire Custom", "Signika", "IM Fell English", serif';
  } else if (mode === "foundry" && fontFamily) {
    familyExpression = `"${String(fontFamily).replaceAll('"', "")}", "Signika", "IM Fell English", serif`;
  }

  if (style.textContent) document.head.append(style);
  document.documentElement.style.setProperty("--gg-font-family", familyExpression);
}

function legacySettingsClass() {
  return class GGAppearanceSettingsLegacy extends FormApplication {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: `${MODULE_ID}-appearance-settings`,
        title: game.i18n.localize("GG.Settings.AppearanceMenu"),
        template: `modules/${MODULE_ID}/templates/appearance-settings.hbs`,
        width: 520,
        closeOnSubmit: true,
        submitOnChange: false
      });
    }

    getData() {
      return settingsContext();
    }

    activateListeners(html) {
      super.activateListeners(html);
      html.find(".gg-font-browse").on("click", (event) => {
        event.preventDefault();
        openFontPicker(html.find("input[name='fontPath']")[0]);
      });
    }

    async _updateObject(_event, formData) {
      try {
        await saveFontSettings(formData);
      } catch (error) {
        reportSettingsSaveFailure(error);
        throw error;
      }
    }
  };
}

function applicationV2SettingsClass() {
  const api = foundry.applications?.api;
  if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) return null;
  const Base = api.HandlebarsApplicationMixin(api.ApplicationV2);
  return class GGAppearanceSettingsV2 extends Base {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-appearance-settings`,
      tag: "form",
      position: { width: 520 },
      window: { title: "GG.Settings.AppearanceMenu", icon: "fas fa-font" }
    };

    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/appearance-settings-v2.hbs` }
    };

    get title() {
      return game.i18n.localize("GG.Settings.AppearanceMenu");
    }

    async _prepareContext() {
      return settingsContext();
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const form = this.element;
      const browseButton = form?.querySelector(".gg-font-browse");
      if (browseButton && browseButton.dataset.ggBound !== "true") {
        browseButton.dataset.ggBound = "true";
        browseButton.addEventListener("click", (event) => {
          event.preventDefault();
          openFontPicker(form.querySelector("input[name='fontPath']"));
        });
      }
      if (form && form.dataset.ggSubmitBound !== "true") {
        form.dataset.ggSubmitBound = "true";
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (this._ggSubmitting) return;
          this._ggSubmitting = true;
          const submitter = event.submitter;
          if (submitter) submitter.disabled = true;
          try {
            const data = Object.fromEntries(new FormData(form).entries());
            await saveFontSettings(data);
            await this.close();
          } catch (error) {
            reportSettingsSaveFailure(error);
          } finally {
            this._ggSubmitting = false;
            if (submitter?.isConnected) submitter.disabled = false;
          }
        });
      }
    }
  };
}

export function registerAppearanceSettings() {
  game.settings.register(MODULE_ID, "fontMode", { scope: "world", config: false, type: String, default: "foundry" });
  game.settings.register(MODULE_ID, "fontPath", { scope: "world", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, "fontFamily", { scope: "world", config: false, type: String, default: "Signika" });
  const SettingsClass = applicationV2SettingsClass() ?? legacySettingsClass();
  game.settings.registerMenu(MODULE_ID, "appearanceMenu", {
    name: "GG.Settings.AppearanceMenu",
    label: "GG.Settings.AppearanceMenuLabel",
    hint: "GG.Settings.AppearanceMenuHint",
    icon: "fas fa-font",
    type: SettingsClass,
    restricted: true
  });
}
