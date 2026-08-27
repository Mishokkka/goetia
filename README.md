# Goetia Grimoire 0.7.7

Module for Foundry VTT 13.351 and Forbidden Lands 13.0.5.

## Highlights

- diegetic two-page grimoire interface for miracle workers;
- complete Training workspace for learning magic paths, path ranks, and spells;
- bundled training catalog generated from the supplied spell and talent compendiums;
- normalized path-to-discipline binding for existing and newly learned magic paths;
- deterministic unique sigils for every path instead of reused talent artwork;
- manual Druid or Sorcerer classification, with shared S/D paths and unrestricted General spells;
- manual CAP and XCAP toggles, live XP and wallet display, and transparent training costs;
- teacher, written-source, and independent-research workflows with quarter-day progress;
- native Forbidden Lands Year Zero training rolls using base, skill, and negative dice;
- consecutive-success tracking for high path ranks, research ingredient costs, and spell mishaps;
- personal unlock sigils with a centered tracing area;
- movable spell seals with a styled context menu and GM-only seal regeneration;
- structural sigil recognition with a 75% completion threshold and a >91% precision bonus;
- GM-authoritative cast resolution with serialized WP spending and chat audit flags;
- automatic Chance Casting when spell rank exceeds the character's highest magic-talent rank, plus mishap resolution from spell-die 1s, separate 0-6 RollTables, mishap audio, and synchronized distorted cast sigils;
- GM-authored actor-level contract with physical two-page pagination;
- compact sound palette with per-client enable and volume settings, shared file or Foundry Playlist sources, randomized playlist playback, preview playback, optional dedicated PL > 5 and Mishap sounds, full-length cast playback, and a configurable 0.50×–2.00× sigil duration multiplier relative to the selected sound;
- versioned data migration and stale flag cleanup.

Casting requires at least one active GM client. If several GMs are connected, the module deterministically selects one authority client for all cast requests.

## Training

The Training tab reads magic paths from embedded Profession Talent Items whose names begin with `(S)`, `(D)`, or `(S/D)`. The player manually marks the character as a Druid or Sorcerer. Pure paths of the other type are excluded, while S/D paths remain available to both.

General spells are shown as a permanent independent section. Any miracle worker can learn them. Their accessible rank is based on the highest currently known magic-path rank.

Only one training project can be active at a time. XP is spent when training completes. Independent spell research purchases ingredients at project start for `5 × spell XP cost` silver; those ingredients survive failed attempts and are not refunded when the project is cancelled.

The Training tab uses the following character fields from Forbidden Lands:

- XP: `system.bio.experience.value`;
- wallet: `system.currency.gold/silver/copper.value`;
- Wits: `system.attribute.wits.value`;
- Lore: `system.skill.lore.value`.

## Custom and localized talents

The module recognizes the standard English Forbidden Lands path names, `(S)/(D)/(S/D)` Profession Talent prefixes, configurable aliases, and explicit module flags.

To mark a talent directly, set one of these flags on the Item:

```js
await item.setFlag("goetia-grimoire", "role", "magicTalent");
await item.setFlag("goetia-grimoire", "role", "psychicPower");
```

To force the grimoire onto a character whose talents cannot be identified:

```js
await actor.setFlag("goetia-grimoire", "forceMiracleWorker", true);
```

Aliases can also be entered in Module Settings as comma-separated or line-separated names.

## Source structure

- `scripts/grimoire.js`: actor-sheet and ritual orchestration;
- `scripts/training.js`: training catalog UI, rules, rolls, progress, and embedded Item updates;
- `data/training-catalog.json`: bundled path and spell source data;
- `scripts/drawing-controller.js`: bounded canvas input and rendering;
- `scripts/audio-service.js`: Foundry audio integration and browser fallback;
- `scripts/cast-network.js`: GM-authoritative casting protocol;
- `scripts/mishap-service.js`: GM-configurable 0-6 mishap table routing and automatic RollTable draws;
- `scripts/year-zero-roll.js`: shared Forbidden Lands Year Zero roll-class discovery, evaluation, and success counting;
- `scripts/cast-fx.js`: queued synchronized cast presentation;
- `scripts/sigil.js`: deterministic sigil generation and recognition;
- `scripts/sheet-adapter.js`: Foundry sheet-layout discovery;
- `scripts/appearance-settings.js`: Application V2 and legacy settings UI;
- `scripts/data-schema.js`: migrations and stale flag cleanup;
- `scripts/user-authority.js`: deterministic active-GM selection shared by casting and migrations.

## Tests

With Node.js installed, run:

```bash
npm test
```

The smoke suite validates generated sigils, shared client/server spell seeds, native training dice integration, path-talent creation, the training catalog, source reachability, localization parity, the manifest, and CSS ownership.

Install the folder as `Data/modules/goetia-grimoire`.
