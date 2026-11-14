/**
 * Kingdom Rules (Simplified) — entry point.
 */
import { MODULE_ID, TYPES } from "./config.mjs";
import * as config from "./config.mjs";
import * as rules from "./rules.mjs";
import * as api from "./kingdom-api.mjs";
import * as checks from "./checks.mjs";
import * as projects from "./projects.mjs";
import KingdomData from "./data/kingdom.mjs";
import { AgreementData, BuildingData, FeatData } from "./data/items.mjs";
import KingdomSheet from "./apps/kingdom-sheet.mjs";
import KingdomItemSheet from "./apps/item-sheet.mjs";
import TurnWizard from "./apps/turn-wizard.mjs";

Hooks.once("init", () => {
  // The system's init runs before ours, so these additions aren't overwritten.
  Object.assign(CONFIG.Actor.dataModels, { [TYPES.kingdom]: KingdomData });
  Object.assign(CONFIG.Item.dataModels, { [TYPES.building]: BuildingData, [TYPES.feat]: FeatData, [TYPES.agreement]: AgreementData });

  CONFIG.Actor.typeLabels ??= {};
  CONFIG.Actor.typeLabels[TYPES.kingdom] ??= `TYPES.Actor.${TYPES.kingdom}`;
  CONFIG.Item.typeLabels ??= {};
  CONFIG.Item.typeLabels[TYPES.building] ??= `TYPES.Item.${TYPES.building}`;
  CONFIG.Item.typeLabels[TYPES.feat] ??= `TYPES.Item.${TYPES.feat}`;
  CONFIG.Item.typeLabels[TYPES.agreement] ??= `TYPES.Item.${TYPES.agreement}`;

  CONFIG.Actor.typeIcons ??= {};
  CONFIG.Actor.typeIcons[TYPES.kingdom] = "fa-solid fa-chess-rook";
  CONFIG.Item.typeIcons ??= {};
  CONFIG.Item.typeIcons[TYPES.building] = "fa-solid fa-house";
  CONFIG.Item.typeIcons[TYPES.feat] = "fa-solid fa-star";
  CONFIG.Item.typeIcons[TYPES.agreement] = "fa-solid fa-file-signature";

  // dnd5e picks default artwork from here (create dialog and new documents).
  const art = CONFIG.DND5E?.defaultArtwork;
  if ( art ) {
    art.Actor ??= {};
    art.Item ??= {};
    art.Actor[TYPES.kingdom] = `modules/${MODULE_ID}/icons/kingdom.svg`;
    art.Item[TYPES.building] = `modules/${MODULE_ID}/icons/building.svg`;
    art.Item[TYPES.feat] = `modules/${MODULE_ID}/icons/feat.svg`;
    art.Item[TYPES.agreement] = `modules/${MODULE_ID}/icons/agreement.svg`;
  }

  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(Actor, MODULE_ID, KingdomSheet, {
    types: [TYPES.kingdom], makeDefault: true, label: "Kingdom Sheet"
  });
  DocumentSheetConfig.registerSheet(Item, MODULE_ID, KingdomItemSheet, {
    types: [TYPES.building, TYPES.feat, TYPES.agreement], makeDefault: true, label: "Kingdom Item Sheet"
  });

  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/sheet/header.hbs`,
    `modules/${MODULE_ID}/templates/sheet/nav.hbs`,
    `modules/${MODULE_ID}/templates/sheet/overview.hbs`,
    `modules/${MODULE_ID}/templates/sheet/advisors.hbs`,
    `modules/${MODULE_ID}/templates/sheet/settlements.hbs`,
    `modules/${MODULE_ID}/templates/sheet/projects.hbs`,
    `modules/${MODULE_ID}/templates/sheet/kingdom.hbs`,
    `modules/${MODULE_ID}/templates/item-sheet.hbs`,
    `modules/${MODULE_ID}/templates/apps/turn-wizard.hbs`
  ]);

  game.modules.get(MODULE_ID).api = {
    config, rules, ...api, ...checks, ...projects, TurnWizard,
    /** Open the weekly turn for a kingdom actor. */
    startTurn: actor => new TurnWizard(actor).render({ force: true })
  };
});

/* New kingdoms get the kingdom icon and a linked token. */
Hooks.on("preCreateActor", (actor, data) => {
  if ( actor.type !== TYPES.kingdom ) return;
  const updates = { "prototypeToken.actorLink": true };
  if ( !data.img || data.img === Actor.implementation.DEFAULT_ICON || data.img.includes("mystery-man") || data.img.includes("documents/actor") ) {
    updates.img = `modules/${MODULE_ID}/icons/kingdom.svg`;
  }
  actor.updateSource(updates);
});

Hooks.on("preCreateItem", (item, data) => {
  if ( ![TYPES.building, TYPES.feat, TYPES.agreement].includes(item.type) ) return;
  if ( !data.img || data.img.includes("item-bag") || data.img.includes("documents/item") ) {
    const icon = { [TYPES.building]: "building", [TYPES.feat]: "feat", [TYPES.agreement]: "agreement" }[item.type];
    item.updateSource({ img: `modules/${MODULE_ID}/icons/${icon}.svg` });
  }
});

/* Reroll buttons on kingdom check cards. */
Hooks.on("renderChatMessageHTML", (message, html) => checks.onRenderChatMessage(message, html));

/* Keep open kingdom sheets fresh when an advisor's linked actor is renamed. */
Hooks.on("updateActor", actor => {
  if ( actor.type === TYPES.kingdom ) return;
  for ( const k of game.actors.filter(a => a.type === TYPES.kingdom) ) {
    if ( Object.values(k.system.advisors).some(a => a.actorUuid === actor.uuid) && k.sheet?.rendered ) k.sheet.render();
  }
});
