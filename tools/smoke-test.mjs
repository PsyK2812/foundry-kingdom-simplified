/**
 * Smoke test: runs the Foundry-facing code against a small mock of the Foundry API.
 * It checks that a full week plays through and the numbers land where the rules say.
 * Run: node tools/smoke-test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import * as yaml from "js-yaml";
import { buildingDoc, featDoc } from "./build-packs.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/* ------------------------------------------------------------------ */
/*  Mock Foundry                                                       */
/* ------------------------------------------------------------------ */

const getProp = (o, k) => k.split(".").reduce((x, p) => x?.[p], o);
function setProp(o, k, v) {
  const parts = k.split(".");
  const last = parts.pop();
  let t = o;
  for ( const p of parts ) t = (t[p] ??= {});
  t[last] = v;
}

class Field {
  constructor(opts={}) {
    this.opts = opts;
  }
  get initial() {
    return typeof this.opts.initial === "function" ? this.opts.initial() : structuredClone(this.opts.initial ?? null);
  }
}
class SchemaField extends Field {
  constructor(fields, opts) {
    super(opts);
    this.fields = fields;
  }
  get initial() {
    return Object.fromEntries(Object.entries(this.fields).map(([k, f]) => [k, f.initial]));
  }
}
class ArrayField extends Field { get initial() { return []; } }
class ObjectField extends Field { get initial() { return {}; } }
class StringField extends Field { get initial() { return this.opts.initial ?? ""; } }
class NumberField extends Field {}
class BooleanField extends Field { get initial() { return this.opts.initial ?? false; } }
class HTMLField extends StringField {}

class TypeDataModel {
  static create(parent) {
    const model = Object.create(this.prototype);
    Object.assign(model, Object.fromEntries(Object.entries(this.defineSchema()).map(([k, f]) => [k, f.initial])));
    Object.defineProperty(model, "parent", { value: parent, enumerable: false });
    return model;
  }
}

let idCounter = 0;
const randomID = () => `id${String(++idCounter).padStart(14, "0")}`;
const chatLog = [];
const notes = [];

let nextD10 = [];
class Roll {
  constructor(formula, data={}) {
    this.formula = formula;
    this.data = data;
  }
  async evaluate() {
    const m = this.formula.match(/^(\d+)d(\d+)/);
    const count = Number(m[1]);
    const faces = Number(m[2]);
    const results = [];
    for ( let i = 0; i < count; i++ ) results.push({ result: nextD10.length ? nextD10.shift() : Math.ceil(faces / 2), active: true });
    let total = results.reduce((t, r) => t + r.result, 0);
    if ( this.formula.includes("2d20kh") ) total = Math.max(...results.map(r => r.result));
    for ( const [key, value] of Object.entries(this.data) ) {
      const sign = this.formula.includes(`- @${key}`) ? -1 : 1;
      if ( this.formula.includes(`@${key}`) ) total += sign * value;
    }
    this.dice = [{ results }];
    this.total = total;
    return this;
  }
  async toMessage(data) {
    chatLog.push({ ...data, roll: this });
    return { getFlag: () => null };
  }
}

globalThis.foundry = {
  data: { fields: { SchemaField, ArrayField, ObjectField, StringField, NumberField, BooleanField, HTMLField } },
  abstract: { TypeDataModel },
  utils: {
    randomID,
    deepClone: o => structuredClone(o),
    escapeHTML: s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    isEmpty: o => !o || !Object.keys(o).length,
    setProperty: setProp
  },
  applications: {
    api: {
      DialogV2: { confirm: async () => true, prompt: async () => null, wait: async () => null },
      ApplicationV2: class { get state() { return 0; } render() { return this; } close() { this.closed = true; } },
      HandlebarsApplicationMixin: B => B
    },
    sheets: {
      ActorSheetV2: class { async _prepareContext() { return {}; } async _preparePartContext(id, c) { return c; } },
      ItemSheetV2: class { async _prepareContext() { return {}; } }
    },
    ux: { TextEditor: { implementation: { enrichHTML: async s => s } } }
  }
};
globalThis.Roll = Roll;
globalThis.Hooks = { callAll() {}, on() { return 1; }, off() {} };
globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m), error: m => notes.push(m) } };
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  getWhisperRecipients: () => [],
  create: async d => chatLog.push(d)
};
globalThis.game = { user: { isGM: true }, packs: new Map(), items: [] };
Math.clamp ??= (v, a, b) => Math.min(Math.max(v, a), b);

const { TYPES } = await import("../scripts/config.mjs");
const { default: KingdomData } = await import("../scripts/data/kingdom.mjs");
const { AgreementData, BuildingData, FeatData } = await import("../scripts/data/items.mjs");
const K = await import("../scripts/kingdom-api.mjs");
const P = await import("../scripts/projects.mjs");
const C = await import("../scripts/checks.mjs");
const { default: TurnWizard } = await import("../scripts/apps/turn-wizard.mjs");

/** Minimal Actor. */
class MockActor {
  constructor(name) {
    this.name = name;
    this.type = TYPES.kingdom;
    this.uuid = `Actor.${randomID()}`;
    this.items = new ItemCollection();
    this.system = KingdomData.create(this);
    this.system.prepareDerivedData();
    this.isOwner = true;
  }
  async update(updates) {
    for ( const [k, v] of Object.entries(updates) ) {
      const parts = k.split(".");
      const last = parts.at(-1);
      if ( last.startsWith("-=") ) {
        delete getProp(this, parts.slice(0, -1).join("."))[last.slice(2)];
        continue;
      }
      if ( k.startsWith("system.") ) setProp(this.system, k.slice(7), structuredClone(v));
      else setProp(this, k, v);
    }
    this.system.prepareDerivedData();
    return this;
  }
  async createEmbeddedDocuments(type, data) {
    return data.map(d => this.items.add(d, this));
  }
  async deleteEmbeddedDocuments(type, ids) {
    ids.forEach(id => this.items.delete(id));
  }
}
class ItemCollection extends Array {
  add(d, actor) {
    const model = { [TYPES.building]: BuildingData, [TYPES.agreement]: AgreementData }[d.type] ?? FeatData;
    const system = model.create(null);
    Object.assign(system, structuredClone(d.system));
    const item = {
      id: randomID(), name: d.name, type: d.type, img: d.img, system, parent: actor,
      async update(u) {
        for ( const [k, v] of Object.entries(u) ) setProp(this, k, v);
      },
      toObject() { return structuredClone({ name: this.name, type: this.type, system: this.system }); }
    };
    this.push(item);
    return item;
  }
  get(id) { return this.find(i => i.id === id); }
  delete(id) {
    const i = this.findIndex(x => x.id === id);
    if ( i >= 0 ) this.splice(i, 1);
  }
}

const buildings = Object.fromEntries(yaml.load(fs.readFileSync(path.join(ROOT, "src/packs/buildings.yaml"), "utf8"))
  .map(b => [b.identifier, buildingDoc(b)]));
const feats = Object.fromEntries(yaml.load(fs.readFileSync(path.join(ROOT, "src/packs/feats.yaml"), "utf8"))
  .map(f => [f.identifier, featDoc(f)]));
globalThis.fromUuid = async uuid => {
  const id = uuid.replace("Compendium.kingdom-simplified.buildings.Item.", "");
  const b = buildings[id];
  return b ? { ...b, toObject: () => structuredClone(b) } : null;
};
globalThis.fromUuidSync = () => null;

let n = 0;
async function test(name, fn) {
  try {
    await fn();
    n++;
    console.log(`ok - ${name}`);
  } catch(err) {
    console.log(`FAIL - ${name}\n  ${err.stack}`);
    process.exitCode = 1;
  }
}

/** Run the wizard's Next action like a click. */
async function next(wizard) {
  await TurnWizard.DEFAULT_OPTIONS.actions.next.call(wizard);
}

/* ------------------------------------------------------------------ */

const kingdom = new MockActor("Varnhold Reach");
await kingdom.update({ "system.government": "feudalism", "system.setup.freeChoice": "loyalty", "system.rp": 100 });

await test("first settlement: no Growing Pains, becomes capital", async () => {
  await K.addSettlement(kingdom);
  assert.equal(kingdom.system.settlements.length, 1);
  assert.equal(kingdom.system.settlements[0].capital, true);
  assert.equal(kingdom.system.unrest, 0);
});
const cap = kingdom.system.settlements[0].id;

await test("placing a Tavern: first-build Unrest −1 (floored at 0) and Renown", async () => {
  await kingdom.update({ "system.unrest": 2 });
  await K.placeBuilding(kingdom, buildings.tavern, cap);
  assert.equal(kingdom.system.unrest, 1);
  assert.equal(kingdom.system.renown, 1);
  assert.deepEqual(kingdom.system.builtTypes, ["tavern"]);
  assert.equal(kingdom.items.length, 1);
  assert.equal(kingdom.items[0].system.settlement, cap);
});

await test("second settlement: Growing Pains +1 Unrest", async () => {
  await K.addSettlement(kingdom);
  assert.equal(kingdom.system.unrest, 2);
});

await test("start a Build Structure project: pays cost with Unrest surcharge", async () => {
  const snap = kingdom.system.snapshot;
  const cost = (await import("../scripts/rules.mjs")).projectCost(snap, "buildStructure", 40);
  assert.equal(cost.final, 44); // Unrest 2 -> +10%
  await P.startProject(kingdom, {
    type: "buildStructure", name: "Brewery in Capital", pay: cost.final, cost, weeks: 2,
    settlement: cap, building: { uuid: "Compendium.kingdom-simplified.buildings.Item.brewery" }
  });
  assert.equal(kingdom.system.rp, 56);
  assert.equal(kingdom.system.projects.length, 1);
  assert.equal(kingdom.system.projects[0].focus, true);
});

await test("kingdom action: requires the building", async () => {
  const state = K.actionAvailable(kingdom, "tithes");
  assert.equal(state.has, false);
});

await test("full week through the wizard", async () => {
  await kingdom.update({ "system.tradeAgreements": [{ id: "t1", name: "Restov", dice: 2 }], "system.farmland": 1 });
  const w = new TurnWizard(kingdom);
  w.element = { querySelectorAll: sel => (sel.includes("data-focus") ? [{ dataset: { focus: kingdom.system.projects[0].id } }] : []) };

  // 1. Petition: absent -> +1 Unrest
  w.turn.attended = false;
  await next(w);
  assert.equal(kingdom.system.unrest, 3);
  assert.equal(kingdom.system.missedPetitions, 1);
  // 2. Quell: skipped (absent)
  await next(w);
  // 3. RP: 2d10 from trade; roll 7 and 4
  nextD10 = [7, 4];
  await TurnWizard.DEFAULT_OPTIONS.actions.rollRp.call(w);
  assert.equal(w.turn.rp.total, 11);
  await next(w);
  assert.equal(kingdom.system.rp, 67);
  // 4. Projects: focus doubles progress -> 2/2, Brewery completes
  await next(w);
  assert.equal(kingdom.system.projects.length, 0);
  assert.ok(kingdom.items.some(i => i.system.identifier === "brewery"));
  assert.equal(kingdom.system.renown, 2);
  // 5. Armies
  await next(w);
  // 6. Food: 1 farmland vs 2 villages -> -1, Hunger 1, +1 Unrest
  await next(w);
  assert.equal(kingdom.system.hunger, 1);
  assert.equal(kingdom.system.unrest, 4);
  // End
  await next(w);
  assert.equal(w.closed, true);
  assert.equal(kingdom.system.week, 2);
  assert.ok(kingdom.system.log.length > 5);
});

await test("next week's RP roll is reduced by Hunger 1 (25%)", async () => {
  const w = new TurnWizard(kingdom);
  w.element = { querySelectorAll: () => [] };
  w.turn.attended = true;
  await next(w);
  assert.equal(kingdom.system.missedPetitions, 0);
  await next(w);
  nextD10 = [10, 9, 6]; // trade 2 + brewery 1
  await TurnWizard.DEFAULT_OPTIONS.actions.rollRp.call(w);
  const before = kingdom.system.rp;
  await next(w);
  assert.equal(kingdom.system.rp - before, Math.floor(25 * 0.75));
});

await test("Quell Unrest: success lowers Unrest, uses it for the week", async () => {
  await kingdom.update({ "system.usage": {} });
  const before = kingdom.system.unrest;
  nextD10 = [15];
  await C.rollKingdomCheck(kingdom, { ability: "loyalty", difficulty: "normal", mode: "normal", quell: true });
  assert.equal(kingdom.system.unrest, before - 1);
  assert.equal(kingdom.system.usage.quell, kingdom.system.week);
  const card = chatLog.at(-1);
  assert.match(card.flavor, /Success/);
});

await test("Quell Unrest: natural 1 adds Unrest", async () => {
  await kingdom.update({ "system.usage": {} });
  const before = kingdom.system.unrest;
  nextD10 = [1];
  await C.rollKingdomCheck(kingdom, { ability: "loyalty", difficulty: "normal", mode: "normal", quell: true });
  assert.equal(kingdom.system.unrest, before + 1);
});

await test("kingdom check applies the Unrest penalty", async () => {
  const pen = kingdom.system.unrestTier.penalty;
  const mod = kingdom.system.derived.abilities.stability.mod;
  nextD10 = [10];
  await C.rollKingdomCheck(kingdom, { ability: "stability", difficulty: "hard", mode: "normal" });
  const card = chatLog.at(-1);
  assert.equal(card.roll.total, 10 + mod + kingdom.system.prof - pen);
  assert.match(card.flavor, new RegExp(`DC ${kingdom.system.dc + 2}`));
});

await test("holiday: no Unrest gained", async () => {
  await kingdom.update({ "system.holidayWeek": kingdom.system.week });
  const before = kingdom.system.unrest;
  await K.changeUnrest(kingdom, 3, "Test");
  assert.equal(kingdom.system.unrest, before);
  await kingdom.update({ "system.holidayWeek": null });
});

await test("Festival Hall: first event Unrest each week −1", async () => {
  await K.placeBuilding(kingdom, buildings["festival-hall"], cap, { effects: false });
  const before = kingdom.system.unrest;
  await K.changeUnrest(kingdom, 2, "Raid", { fromEvent: true });
  assert.equal(kingdom.system.unrest, before + 1);
  await K.changeUnrest(kingdom, 2, "Raid again", { fromEvent: true });
  assert.equal(kingdom.system.unrest, before + 3);
});

await test("Palace build sets Unrest to 0; Stone Wall replaces Wooden Wall", async () => {
  await K.placeBuilding(kingdom, buildings.palace, cap);
  assert.equal(kingdom.system.unrest, 0);
  await K.placeBuilding(kingdom, buildings["wooden-wall"], cap);
  await K.placeBuilding(kingdom, buildings["stone-wall"], cap);
  assert.equal(kingdom.items.filter(i => i.system.identifier === "wooden-wall").length, 0);
  assert.equal(kingdom.items.filter(i => i.system.identifier === "stone-wall").length, 1);
});

await test("Theater adds 1 Renown once per week", async () => {
  await K.placeBuilding(kingdom, buildings.theater, cap, { effects: false });
  await kingdom.update({ "system.lastRenownWeek": null });
  const r0 = kingdom.system.renown;
  await K.gainRenown(kingdom, 1, "Milestone");
  assert.equal(kingdom.system.renown, r0 + 2);
  await K.gainRenown(kingdom, 1, "Another");
  assert.equal(kingdom.system.renown, r0 + 3);
});

await test("level up spends Renown", async () => {
  await kingdom.update({ "system.renown": 7, "system.level": 1 });
  await K.levelUp(kingdom);
  assert.equal(kingdom.system.level, 2);
  assert.equal(kingdom.system.renown, 2);
});

await test("expand settlement and farmland completion", async () => {
  await kingdom.update({ "system.projects": [
    { id: "e1", type: "expandSettlement", name: "Grow", cost: 100, weeksNeeded: 1, weeksDone: 1, focus: false, settlement: cap, buildingUuid: "", hexes: 1, notes: "" },
    { id: "f1", type: "establishFarmland", name: "Farm", cost: 40, weeksNeeded: 3, weeksDone: 3, focus: false, settlement: "", buildingUuid: "", hexes: 1, notes: "" }
  ] });
  const farmland = kingdom.system.farmland;
  const unrest = kingdom.system.unrest;
  await P.completeProject(kingdom, "e1");
  await P.completeProject(kingdom, "f1");
  assert.equal(kingdom.system.settlements.find(s => s.id === cap).size, "town");
  assert.equal(kingdom.system.farmland, farmland + 1);
  assert.equal(kingdom.system.unrest, unrest + 1);
  assert.equal(kingdom.system.projects.length, 0);
});

await test("kingdom actions: tithes needs a Cathedral, then works once per week", async () => {
  await K.placeBuilding(kingdom, buildings.cathedral, cap, { effects: false });
  const rp = kingdom.system.rp;
  await K.runAction(kingdom, "tithes");
  assert.equal(kingdom.system.rp, rp + 20);
  await K.runAction(kingdom, "tithes");
  assert.equal(kingdom.system.rp, rp + 20);
  assert.match(notes.at(-1), /used/);
});

await test("Bank loan and overdue Unrest at end of week", async () => {
  await K.placeBuilding(kingdom, buildings.bank, cap, { effects: false });
  globalThis.foundry.applications.api.DialogV2.prompt = async () => 50;
  await K.takeLoan(kingdom);
  assert.equal(kingdom.system.loan.amount, 50);
  await kingdom.update({ "system.week": kingdom.system.loan.dueWeek });
  const w = new TurnWizard(kingdom);
  w.element = { querySelectorAll: () => [] };
  w.turn.step = 6;
  const u = kingdom.system.unrest;
  await next(w);
  assert.equal(kingdom.system.unrest, u + 1);
  await K.repayLoan(kingdom);
  assert.equal(kingdom.system.loan.amount, 0);
});

await test("Hunger 3: each project rolls, 50 or lower stalls", async () => {
  await kingdom.update({ "system.hunger": 3, "system.holidayWeek": null, "system.projects": [
    { id: "s1", type: "research", name: "Stalls", cost: 0, weeksNeeded: 5, weeksDone: 0, focus: false, settlement: "", buildingUuid: "", hexes: 1, notes: "" },
    { id: "s2", type: "research", name: "Moves", cost: 0, weeksNeeded: 5, weeksDone: 0, focus: false, settlement: "", buildingUuid: "", hexes: 1, notes: "" }
  ] });
  const w = new TurnWizard(kingdom);
  w.element = { querySelectorAll: () => [] };
  w.turn.step = 3;
  nextD10 = [30, 80];
  await next(w);
  assert.equal(kingdom.system.projects.find(p => p.id === "s1").weeksDone, 0);
  assert.equal(kingdom.system.projects.find(p => p.id === "s2").weeksDone, 1);
  await kingdom.update({ "system.hunger": 0, "system.projects": [] });
});

await test("agreement: sign, surcharge, missed month, repay in full", async () => {
  const { agreementDoc } = await import("./build-packs.mjs");
  const doc = agreementDoc(yaml.load(fs.readFileSync(path.join(ROOT, "src/packs/agreements.yaml"), "utf8"))[0]);
  globalThis.foundry.applications.api.DialogV2.confirm = async () => true;
  await kingdom.update({ "system.week": 20, "system.rp": 0, "system.unrest": 0, "system.projects": [], "system.hunger": 0 });
  const R = await import("../scripts/rules.mjs");
  await K.signAgreement(kingdom, doc);
  const item = kingdom.items.find(i => i.type === TYPES.agreement);
  assert.equal(kingdom.system.rp, 100);
  assert.equal(item.system.debt, 100);
  assert.equal(item.system.signedWeek, 20);
  assert.equal(R.projectCost(kingdom.system.snapshot, "buildStructure", 40).final, 48);

  // Pay 2 RP, then let the month end at week 23 without the minimum
  globalThis.foundry.applications.api.DialogV2.prompt = async () => 2;
  await K.repayAgreement(kingdom, item.id);
  assert.equal(item.system.debt, 98);
  assert.equal(kingdom.system.rp, 98);
  await kingdom.update({ "system.week": 23 });
  const w = new TurnWizard(kingdom);
  w.element = { querySelectorAll: () => [] };
  w.turn.step = 6;
  const preview = await w._prepareContext();
  assert.match(preview.body, /surcharge rises to 25%/);
  await next(w);
  assert.equal(item.system.surcharge, 25);
  assert.equal(item.system.missed, 1);
  assert.equal(item.system.paidThisPeriod, 0);
  assert.equal(item.system.periodStart, 24);

  // Repay everything: surcharge ends
  globalThis.foundry.applications.api.DialogV2.prompt = async () => 500;
  await K.repayAgreement(kingdom, item.id);
  assert.equal(item.system.debt, 0);
  assert.equal(kingdom.system.rp, 0);
  assert.equal(R.projectCost(kingdom.system.snapshot, "buildStructure", 40).final, 40);
  assert.equal(R.activeAgreements(kingdom.system.snapshot).length, 0);
});

await test("kingdom sheet context renders all templates", async () => {
  const { default: KingdomSheet } = await import("../scripts/apps/kingdom-sheet.mjs");
  const { default: Handlebars } = await import("handlebars");
  Handlebars.registerHelper("checked", v => (v ? "checked" : ""));
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("selectOptions", (options, opts) => new Handlebars.SafeString(Object.entries(options)
    .map(([k, v]) => `<option value="${k}" ${k === String(opts.hash.selected ?? "") ? "selected" : ""}>${v}</option>`).join("")));
  game.user.isGM = true;
  await kingdom.update({ "system.events": [{ id: "ev", name: "Drought", weeksLeft: 2, dice: -1, food: -1, notes: "" }] });
  await kingdom.createEmbeddedDocuments("Item", [feats["kingdom-assurance"], feats["festival-season"]]);
  await K.placeBuilding(kingdom, buildings.menagerie, cap, { effects: false });
  await K.placeBuilding(kingdom, buildings.stockyard, cap, { effects: false });
  await K.placeBuilding(kingdom, buildings.shrine, cap, { effects: false });
  const sheet = Object.create(KingdomSheet.prototype);
  Object.defineProperty(sheet, "actor", { value: kingdom });
  Object.defineProperty(sheet, "isEditable", { value: true });
  sheet.activeTab = "settlements";
  const context = await sheet._prepareContext({});
  for ( const part of Object.keys(KingdomSheet.PARTS) ) {
    const file = KingdomSheet.PARTS[part].template.replace("modules/kingdom-simplified/", "");
    const tpl = Handlebars.compile(fs.readFileSync(path.join(ROOT, file), "utf8"), { strict: false });
    const partCtx = await sheet._preparePartContext(part, { ...context }, {});
    const html = tpl(partCtx);
    assert.ok(html.length > 20, `${part} rendered`);
    if ( part === "settlements" ) {
      assert.match(html, /Menagerie/);
      assert.match(html, /Slaughter/);
      assert.match(html, /Priest/);
    }
    if ( part === "overview" ) assert.match(html, /Collect tithes/);
  }
  assert.equal(context.abilities.length, 4);
  assert.equal(context.settlements.length, 2);
  for ( const player of [false] ) {
    game.user.isGM = player;
    const c2 = await sheet._prepareContext({});
    const tpl = Handlebars.compile(fs.readFileSync(path.join(ROOT, "templates/sheet/overview.hbs"), "utf8"));
    assert.match(tpl(await sheet._preparePartContext("overview", c2, {})), /disabled/);
  }
  game.user.isGM = true;
});

await test("item sheet context renders", async () => {
  const { default: KingdomItemSheet } = await import("../scripts/apps/item-sheet.mjs");
  const { default: Handlebars } = await import("handlebars");
  const item = kingdom.items.find(i => i.system.identifier === "stockyard");
  item.isOwner = true;
  const sheet = Object.create(KingdomItemSheet.prototype);
  Object.defineProperty(sheet, "item", { value: item });
  Object.defineProperty(sheet, "isEditable", { value: true });
  const ctx = await sheet._prepareContext({});
  const tpl = Handlebars.compile(fs.readFileSync(path.join(ROOT, "templates/item-sheet.hbs"), "utf8"));
  assert.match(tpl(ctx), /Stockyard/);
});

await test("turn wizard renders every step body", async () => {
  const w = new TurnWizard(kingdom);
  w.element = { querySelectorAll: () => [] };
  for ( let i = 0; i < 7; i++ ) {
    w.turn.step = i;
    w.turn.attended = true;
    if ( i === 2 ) w.turn.rp = { dice: 3, results: [1, 5, 9], rerolled: [4], total: 18 };
    const ctx = await w._prepareContext();
    assert.ok(ctx.body.length > 10, `step ${i}`);
  }
});

console.log(`\n${n} smoke tests passed${process.exitCode ? ", some FAILED" : ""}`);
