import { MODULE_ID, clearTalentAliasCache } from "./config.js";
import { destroyActorSheet, enhanceActorSheet } from "./grimoire.js";
import { handleCastChatMessage, handleCastSocketMessage } from "./cast-network.js";
import { initializeCastFx, registerCastFxSettings, shutdownCastFx } from "./cast-fx.js";
import { registerAudioSettings, stopAllModuleSounds } from "./audio-service.js";
import { registerMishapSettings } from "./mishap-service.js";
import { installConfiguredFont, registerAppearanceSettings } from "./appearance-settings.js";
import {
  cleanupDeletedSpell,
  migrateActorData,
  registerDataSchemaSettings,
  runWorldMigrations,
  shouldMigrateActorAfterItemCreate
} from "./data-schema.js";
import { isAuthoritativeGm } from "./user-authority.js";

Hooks.once("init", () => {
  console.log("Goetia Grimoire | Initializing");

  game.settings.register(MODULE_ID, "enabled", {
    name: "GG.Settings.Enabled",
    hint: "GG.Settings.EnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "magicTalentAliases", {
    name: "GG.Settings.MagicTalentAliases",
    hint: "GG.Settings.MagicTalentAliasesHint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: clearTalentAliasCache
  });

  game.settings.register(MODULE_ID, "psychicPowerAliases", {
    name: "GG.Settings.PsychicPowerAliases",
    hint: "GG.Settings.PsychicPowerAliasesHint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: clearTalentAliasCache
  });

  game.settings.register(MODULE_ID, "entranceTheme", {
    name: "GG.Settings.EntranceTheme",
    hint: "GG.Settings.EntranceThemeHint",
    scope: "client",
    config: false,
    type: String,
    default: "threads"
  });

  registerAppearanceSettings();
  registerAudioSettings();
  registerMishapSettings();
  registerCastFxSettings();
  registerDataSchemaSettings();
});

Hooks.once("ready", async () => {
  installConfiguredFont();
  initializeCastFx();
  game.socket?.on?.(`module.${MODULE_ID}`, (data) => {
    void handleCastSocketMessage(data).catch((error) => console.error("Goetia Grimoire | Socket handler failed.", error));
  });
  try {
    await runWorldMigrations();
  } catch (error) {
    console.error("Goetia Grimoire | World migration failed.", error);
  }
});

Hooks.on("createChatMessage", (message) => {
  void handleCastChatMessage(message).catch((error) => console.error("Goetia Grimoire | ChatMessage cast FX handler failed.", error));
});

Hooks.on("renderActorSheet", async (app, html) => {
  if (!game.settings.get(MODULE_ID, "enabled")) {
    destroyActorSheet(app);
    return;
  }
  try {
    await enhanceActorSheet(app, html);
  } catch (error) {
    console.error("Goetia Grimoire | Failed to enhance actor sheet.", error);
  }
});

Hooks.on("closeActorSheet", (app) => destroyActorSheet(app));
Hooks.on("deleteItem", (item, _options, userId) => {
  if (userId ? game.user?.id !== userId : !isAuthoritativeGm()) return;
  void cleanupDeletedSpell(item).catch((error) => console.error("Goetia Grimoire | Deleted-spell cleanup failed.", error));
});
Hooks.on("createActor", (actor, _options, userId) => {
  if ((userId && game.user?.id === userId) || (!userId && isAuthoritativeGm())) {
    void migrateActorData(actor).catch((error) => console.error("Goetia Grimoire | New actor migration failed.", error));
  }
});
Hooks.on("createItem", (item, _options, userId) => {
  if (item?.parent?.documentName !== "Actor") return;
  if (!((userId && game.user?.id === userId) || (!userId && isAuthoritativeGm()))) return;
  if (!shouldMigrateActorAfterItemCreate(item.parent, item)) return;
  void migrateActorData(item.parent).catch((error) => console.error("Goetia Grimoire | Actor item migration failed.", error));
});
Hooks.once("shutdown", () => {
  shutdownCastFx();
  stopAllModuleSounds();
});
