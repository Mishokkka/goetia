import { MODULE_ID } from "./config.js";

const lastPlayAt = new Map();
const lastPlaylistSoundByKey = new Map();
const liveHandles = new Set();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setting(name, fallback) {
  try {
    const value = game.settings.get(MODULE_ID, name);
    return value ?? fallback;
  } catch (_error) {
    return fallback;
  }
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

function playlistSoundPaths(playlistId) {
  const id = String(playlistId ?? "").trim();
  if (!id) return [];
  const playlist = game.playlists?.get?.(id) ?? collectionContents(game.playlists).find((entry) => entry?.id === id);
  if (!playlist) return [];
  return collectionContents(playlist.sounds)
    .map((sound) => String(sound?.path ?? sound?.src ?? "").trim())
    .filter(Boolean);
}

function randomPlaylistSource(playlistId, key) {
  const paths = playlistSoundPaths(playlistId);
  if (!paths.length) return "";
  const previous = lastPlaylistSoundByKey.get(key);
  const candidates = paths.length > 1 && previous ? paths.filter((path) => path !== previous) : paths;
  const source = candidates[Math.floor(Math.random() * candidates.length)] ?? paths[0] ?? "";
  if (source) lastPlaylistSoundByKey.set(key, source);
  return source;
}

function configuredSource(prefix) {
  const playlistId = String(setting(`${prefix}SoundPlaylist`, "") ?? "").trim();
  const playlistSource = randomPlaylistSource(playlistId, `configured:${prefix}:${playlistId}`);
  if (playlistSource) return playlistSource;
  return String(setting(`${prefix}SoundPath`, "") ?? "").trim();
}

function helperApi() {
  return foundry.audio?.AudioHelper ?? globalThis.AudioHelper ?? null;
}

function stopNativeAudio(audio) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.src = "";
  } catch (_error) {}
}

async function stopFoundrySound(sound, fadeMs = 0) {
  if (!sound) return;
  try {
    if (fadeMs > 0 && typeof sound.fade === "function") {
      await sound.fade(0, { duration: fadeMs });
    }
  } catch (_error) {}
  try {
    await sound.stop?.();
  } catch (_error) {}
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function finiteDurationMs(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0;
}

function createHandle() {
  const duration = deferred();
  const started = deferred();
  let durationSettled = false;
  let startedSettled = false;
  const handle = {
    stopped: false,
    sound: null,
    audio: null,
    cleanupTimer: 0,
    durationTimer: 0,
    startedAt: 0,
    durationPromise: duration.promise,
    startedPromise: started.promise,
    resolveDuration(value) {
      if (durationSettled) return;
      durationSettled = true;
      if (handle.durationTimer) clearTimeout(handle.durationTimer);
      handle.durationTimer = 0;
      duration.resolve(Math.max(0, Math.round(Number(value) || 0)));
    },
    resolveStarted(value = true) {
      if (startedSettled) return;
      startedSettled = true;
      started.resolve(Boolean(value));
    },
    async stop(fadeMs = 0) {
      if (handle.stopped) return;
      handle.stopped = true;
      liveHandles.delete(handle);
      if (handle.cleanupTimer) clearTimeout(handle.cleanupTimer);
      if (handle.durationTimer) clearTimeout(handle.durationTimer);
      handle.cleanupTimer = 0;
      handle.durationTimer = 0;
      handle.resolveStarted(false);
      handle.resolveDuration(0);
      if (handle.sound) await stopFoundrySound(handle.sound, fadeMs);
      if (handle.audio) stopNativeAudio(handle.audio);
      handle.sound = null;
      handle.audio = null;
    }
  };
  liveHandles.add(handle);
  return handle;
}

async function beginPlayback(handle, { src, volume, loop }) {
  const helper = helperApi();
  if (helper?.play) {
    try {
      const sound = await helper.play({ src, volume, loop, autoplay: true }, false);
      if (handle.stopped) {
        await stopFoundrySound(sound, 0);
        handle.resolveStarted(false);
        handle.resolveDuration(0);
        return;
      }
      handle.sound = sound;
      handle.startedAt = performance.now();
      handle.resolveStarted(true);
      const soundDurationMs = finiteDurationMs(sound?.duration);
      if (soundDurationMs) handle.resolveDuration(soundDurationMs);
      else handle.durationTimer = window.setTimeout(() => handle.resolveDuration(0), 1500);
      if (!loop) {
        const cleanup = () => {
          if (handle.cleanupTimer) clearTimeout(handle.cleanupTimer);
          handle.cleanupTimer = 0;
          liveHandles.delete(handle);
        };
        if (typeof sound?.addEventListener === "function") sound.addEventListener("end", cleanup, { once: true });
        else if (typeof sound?.on === "function") sound.on("end", cleanup);
        handle.cleanupTimer = window.setTimeout(cleanup, Math.max(30000, finiteDurationMs(sound?.duration) + 5000));
      }
      return;
    } catch (error) {
      console.warn("Goetia Grimoire | Foundry audio playback failed; using browser fallback.", error);
    }
  }

  try {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.loop = loop;
    audio.volume = volume;
    handle.audio = audio;
    const settleDuration = () => {
      const durationMs = finiteDurationMs(audio.duration);
      if (durationMs) handle.resolveDuration(durationMs);
    };
    audio.addEventListener("loadedmetadata", settleDuration, { once: true });
    audio.addEventListener("durationchange", settleDuration);
    audio.addEventListener("ended", () => {
      if (handle.cleanupTimer) clearTimeout(handle.cleanupTimer);
      handle.cleanupTimer = 0;
      liveHandles.delete(handle);
    }, { once: true });
    await audio.play();
    handle.startedAt = performance.now();
    handle.resolveStarted(true);
    settleDuration();
    handle.durationTimer = window.setTimeout(() => handle.resolveDuration(0), 1500);
    if (handle.stopped) stopNativeAudio(audio);
  } catch (error) {
    handle.resolveStarted(false);
    handle.resolveDuration(0);
    liveHandles.delete(handle);
    console.warn("Goetia Grimoire | Browser audio playback failed.", error);
  }
}

function configuredPlayback(prefix, { loop = false, minimumInterval = 0 } = {}) {
  if (!setting(`${prefix}SoundEnabled`, false)) return null;
  const now = performance.now();
  const last = lastPlayAt.get(prefix) ?? -Infinity;
  if (!loop && now - last < minimumInterval) return null;
  const src = configuredSource(prefix);
  if (!src) return null;
  lastPlayAt.set(prefix, now);

  const volume = clamp(Number(setting(`${prefix}SoundVolume`, 0.4)) || 0, 0, 1);
  const handle = createHandle();
  void beginPlayback(handle, { src, volume, loop });
  return handle;
}

export function playConfiguredSound(prefix, options = {}) {
  return configuredPlayback(prefix, { loop: false, minimumInterval: 45, ...options });
}

export function startDrawingSound() {
  return configuredPlayback("drawing", { loop: true });
}

export function stopDrawingSound(handle) {
  void handle?.stop?.(120);
}

export function stopSound(handle, fadeMs = 0) {
  void handle?.stop?.(fadeMs);
}

export function stopAllModuleSounds() {
  for (const handle of [...liveHandles]) void handle.stop(0);
  liveHandles.clear();
}

const SOUND_ENTRIES = Object.freeze([
  ["drawing", {
    enabled: "GG.Settings.DrawingSoundEnabled",
    enabledHint: "GG.Settings.DrawingSoundEnabledHint",
    path: "GG.Settings.DrawingSoundPath",
    pathHint: "GG.Settings.DrawingSoundPathHint",
    volume: "GG.Settings.DrawingSoundVolume",
    volumeHint: "GG.Settings.DrawingSoundVolumeHint"
  }, `modules/${MODULE_ID}/sounds/ink-scratch.wav`, 0.35, "fa-pen-nib"],
  ["bookOpen", {
    enabled: "GG.Settings.BookOpenSoundEnabled",
    enabledHint: "GG.Settings.BookOpenSoundEnabledHint",
    path: "GG.Settings.BookOpenSoundPath",
    pathHint: "GG.Settings.BookOpenSoundPathHint",
    volume: "GG.Settings.BookOpenSoundVolume",
    volumeHint: "GG.Settings.BookOpenSoundVolumeHint"
  }, `modules/${MODULE_ID}/sounds/book-open.wav`, 0.45, "fa-book-open"],
  ["pageTurn", {
    enabled: "GG.Settings.PageTurnSoundEnabled",
    enabledHint: "GG.Settings.PageTurnSoundEnabledHint",
    path: "GG.Settings.PageTurnSoundPath",
    pathHint: "GG.Settings.PageTurnSoundPathHint",
    volume: "GG.Settings.PageTurnSoundVolume",
    volumeHint: "GG.Settings.PageTurnSoundVolumeHint"
  }, `modules/${MODULE_ID}/sounds/page-turn.wav`, 0.35, "fa-file-lines"],
  ["tabSwitch", {
    enabled: "GG.Settings.TabSwitchSoundEnabled",
    enabledHint: "GG.Settings.TabSwitchSoundEnabledHint",
    path: "GG.Settings.TabSwitchSoundPath",
    pathHint: "GG.Settings.TabSwitchSoundPathHint",
    volume: "GG.Settings.TabSwitchSoundVolume",
    volumeHint: "GG.Settings.TabSwitchSoundVolumeHint"
  }, `modules/${MODULE_ID}/sounds/tab-switch.wav`, 0.33, "fa-layer-group"],
  ["castFx", {
    enabled: "GG.Settings.CastFxSoundEnabled",
    enabledHint: "GG.Settings.CastFxSoundEnabledHint",
    path: "GG.Settings.CastFxSoundPath",
    pathHint: "GG.Settings.CastFxSoundPathHint",
    volume: "GG.Settings.CastFxSoundVolume",
    volumeHint: "GG.Settings.CastFxSoundVolumeHint"
  }, `modules/${MODULE_ID}/sounds/seal-cast.wav`, 0.45, "fa-wand-sparkles", true],
  ["castFxHighPower", {
    enabled: "GG.Settings.CastFxHighPowerSoundEnabled",
    enabledHint: "GG.Settings.CastFxHighPowerSoundEnabledHint",
    path: "GG.Settings.CastFxHighPowerSoundPath",
    pathHint: "GG.Settings.CastFxHighPowerSoundPathHint",
    volume: "GG.Settings.CastFxHighPowerSoundVolume",
    volumeHint: "GG.Settings.CastFxHighPowerSoundVolumeHint"
  }, "", 0.5, "fa-bolt", true],
  ["castFxMishap", {
    enabled: "GG.Settings.CastFxMishapSoundEnabled",
    enabledHint: "GG.Settings.CastFxMishapSoundEnabledHint",
    path: "GG.Settings.CastFxMishapSoundPath",
    pathHint: "GG.Settings.CastFxMishapSoundPathHint",
    volume: "GG.Settings.CastFxMishapSoundVolume",
    volumeHint: "GG.Settings.CastFxMishapSoundVolumeHint"
  }, "", 0.55, "fa-skull-crossbones", true]
]);

function registerToggle(prefix, labels, defaultValue = true) {
  game.settings.register(MODULE_ID, `${prefix}SoundEnabled`, {
    name: labels.enabled,
    hint: labels.enabledHint,
    scope: "client",
    config: false,
    type: Boolean,
    default: defaultValue
  });
}

function registerPath(prefix, labels, defaultValue) {
  game.settings.register(MODULE_ID, `${prefix}SoundPath`, {
    name: labels.path,
    hint: labels.pathHint,
    scope: "world",
    config: false,
    type: String,
    filePicker: "audio",
    default: defaultValue
  });
}

function registerVolume(prefix, labels, defaultValue) {
  game.settings.register(MODULE_ID, `${prefix}SoundVolume`, {
    name: labels.volume,
    hint: labels.volumeHint,
    scope: "client",
    config: false,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: defaultValue
  });
}

function registerPlaylist(prefix) {
  game.settings.register(MODULE_ID, `${prefix}SoundPlaylist`, {
    name: "GG.Settings.SoundPlaylistShort",
    hint: "GG.Settings.SoundPlaylistHint",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

function localize(key) {
  return game.i18n.localize(key);
}

function audioSettingsContext() {
  const playlists = collectionContents(game.playlists)
    .map((playlist) => ({
      id: String(playlist?.id ?? ""),
      name: String(playlist?.name ?? ""),
      soundCount: playlistSoundPaths(playlist?.id).length
    }))
    .filter((playlist) => playlist.id)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n?.lang));

  return {
    canEditPaths: Boolean(game.user?.isGM),
    entries: SOUND_ENTRIES.map(([prefix, labels, _defaultPath, _defaultVolume, icon]) => {
      const path = String(game.settings.get(MODULE_ID, `${prefix}SoundPath`) ?? "");
      const playlistId = String(game.settings.get(MODULE_ID, `${prefix}SoundPlaylist`) ?? "");
      return {
        prefix,
        icon,
        title: localize(labels.enabled),
        description: localize(labels.enabledHint),
        enabled: Boolean(game.settings.get(MODULE_ID, `${prefix}SoundEnabled`)),
        path,
        filename: path.split(/[\\/]/).pop() || localize("GG.Settings.NoSoundFile"),
        playlistId,
        playlists: playlists.map((playlist) => ({ ...playlist, selected: playlist.id === playlistId })),
        volume: Number(game.settings.get(MODULE_ID, `${prefix}SoundVolume`) ?? 0.4).toFixed(2),
        volumePercent: Math.round(Number(game.settings.get(MODULE_ID, `${prefix}SoundVolume`) ?? 0.4) * 100)
      };
    })
  };
}

async function saveAudioSettings(formData) {
  const values = formData instanceof FormData ? formData : new FormData(formData);
  for (const [prefix] of SOUND_ENTRIES) {
    await game.settings.set(MODULE_ID, `${prefix}SoundEnabled`, values.has(`${prefix}SoundEnabled`));
    const volume = clamp(Number(values.get(`${prefix}SoundVolume`)) || 0, 0, 1);
    await game.settings.set(MODULE_ID, `${prefix}SoundVolume`, volume);
    if (game.user?.isGM && values.has(`${prefix}SoundPath`)) {
      await game.settings.set(MODULE_ID, `${prefix}SoundPath`, String(values.get(`${prefix}SoundPath`) ?? "").trim());
    }
    if (game.user?.isGM && values.has(`${prefix}SoundPlaylist`)) {
      await game.settings.set(MODULE_ID, `${prefix}SoundPlaylist`, String(values.get(`${prefix}SoundPlaylist`) ?? "").trim());
    }
  }
}

function openAudioPicker(input) {
  const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  if (!Picker || !input || !game.user?.isGM) return;
  const picker = new Picker({
    type: "audio",
    current: input.value,
    callback: (selectedPath) => {
      input.value = selectedPath;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  picker.render(true);
}

let previewHandle = null;

function previewSource(form, prefix) {
  const playlistId = String(form.querySelector(`select[name='${prefix}SoundPlaylist']`)?.value ?? "").trim();
  const playlistSource = randomPlaylistSource(playlistId, `preview:${prefix}:${playlistId}`);
  if (playlistSource) return playlistSource;
  return String(form.querySelector(`input[name='${prefix}SoundPath']`)?.value ?? "").trim();
}

async function previewAudio(form, prefix, button) {
  const path = previewSource(form, prefix);
  if (!path) return;
  const volume = clamp(Number(form.querySelector(`input[name='${prefix}SoundVolume']`)?.value) || 0, 0, 1);
  await previewHandle?.stop?.(60);
  previewHandle = createHandle();
  button?.classList.add("is-playing");
  try {
    await beginPlayback(previewHandle, { src: path, volume, loop: false });
  } finally {
    window.setTimeout(() => button?.classList.remove("is-playing"), 700);
  }
}

function bindAudioSettingsForm(form) {
  if (!form) return;
  for (const button of form.querySelectorAll(".gg-audio-browse")) {
    if (button.dataset.ggBound === "true") continue;
    button.dataset.ggBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const prefix = button.dataset.prefix;
      openAudioPicker(form.querySelector(`input[name='${prefix}SoundPath']`));
    });
  }
  for (const button of form.querySelectorAll(".gg-audio-preview")) {
    if (button.dataset.ggBound === "true") continue;
    button.dataset.ggBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      void previewAudio(form, button.dataset.prefix, button);
    });
  }
  for (const input of form.querySelectorAll("input[data-gg-audio-path]")) {
    const filename = form.querySelector(`[data-gg-audio-filename='${input.dataset.ggAudioPath}']`);
    const sync = () => {
      const value = String(input.value ?? "").trim();
      if (filename) {
        filename.textContent = value.split(/[\\/]/).pop() || localize("GG.Settings.NoSoundFile");
        filename.title = value;
      }
    };
    if (input.dataset.ggBound !== "true") {
      input.dataset.ggBound = "true";
      input.addEventListener("change", sync);
      input.addEventListener("input", sync);
    }
    sync();
  }
  for (const input of form.querySelectorAll("input[type='range'][data-gg-volume]")) {
    const output = form.querySelector(`[data-gg-volume-output='${input.dataset.ggVolume}']`);
    const sync = () => { if (output) output.textContent = `${Math.round(Number(input.value) * 100)}%`; };
    if (input.dataset.ggBound !== "true") {
      input.dataset.ggBound = "true";
      input.addEventListener("input", sync);
    }
    sync();
  }
}

function reportAudioSettingsSaveFailure(error) {
  console.error("Goetia Grimoire | Failed to save audio settings.", error);
  const key = "GG.Settings.SaveFailed";
  const message = game.i18n.localize(key);
  ui.notifications.error(message === key ? "Unable to save grimoire settings." : message);
}

function legacyAudioSettingsClass() {
  return class GGAudioSettingsLegacy extends FormApplication {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: `${MODULE_ID}-audio-settings`,
        title: localize("GG.Settings.AudioMenu"),
        template: `modules/${MODULE_ID}/templates/audio-settings.hbs`,
        width: 720,
        height: 560,
        closeOnSubmit: true,
        submitOnChange: false
      });
    }

    getData() {
      return audioSettingsContext();
    }

    activateListeners(html) {
      super.activateListeners(html);
      bindAudioSettingsForm(html[0]);
    }

    async _updateObject(_event, formData) {
      const data = new FormData();
      for (const [key, value] of Object.entries(formData)) data.set(key, value);
      for (const [prefix] of SOUND_ENTRIES) {
        const checkbox = this.form?.querySelector?.(`input[name='${prefix}SoundEnabled']`);
        if (checkbox?.checked) data.set(`${prefix}SoundEnabled`, "on");
      }
      try {
        await saveAudioSettings(data);
      } catch (error) {
        reportAudioSettingsSaveFailure(error);
        throw error;
      }
    }
  };
}

function applicationV2AudioSettingsClass() {
  const api = foundry.applications?.api;
  if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) return null;
  const Base = api.HandlebarsApplicationMixin(api.ApplicationV2);
  return class GGAudioSettingsV2 extends Base {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-audio-settings`,
      tag: "form",
      position: { width: 720, height: 560 },
      window: { title: "GG.Settings.AudioMenu", icon: "fas fa-volume-high" }
    };

    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/audio-settings-v2.hbs` }
    };

    get title() {
      return localize("GG.Settings.AudioMenu");
    }

    async _prepareContext() {
      return audioSettingsContext();
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const form = this.element;
      bindAudioSettingsForm(form);
      if (form && form.dataset.ggSubmitBound !== "true") {
        form.dataset.ggSubmitBound = "true";
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (this._ggSubmitting) return;
          this._ggSubmitting = true;
          const submitter = event.submitter;
          if (submitter) submitter.disabled = true;
          try {
            await saveAudioSettings(new FormData(form));
            await this.close();
          } catch (error) {
            reportAudioSettingsSaveFailure(error);
          } finally {
            this._ggSubmitting = false;
            if (submitter?.isConnected) submitter.disabled = false;
          }
        });
      }
    }
  };
}

export function registerAudioSettings() {
  for (const [prefix, labels, path, volume, _icon, defaultEnabled = true] of SOUND_ENTRIES) {
    registerToggle(prefix, labels, defaultEnabled);
    registerPath(prefix, labels, path);
    registerPlaylist(prefix);
    registerVolume(prefix, labels, volume);
  }
  const SettingsClass = applicationV2AudioSettingsClass() ?? legacyAudioSettingsClass();
  game.settings.registerMenu(MODULE_ID, "audioMenu", {
    name: "GG.Settings.AudioMenu",
    label: "GG.Settings.AudioMenuLabel",
    hint: "GG.Settings.AudioMenuHint",
    icon: "fas fa-volume-high",
    type: SettingsClass,
    restricted: false
  });
}
