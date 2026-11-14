/**
 * Unit tests for scripts/rules.mjs. Run: node tools/test-rules.mjs
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import * as yaml from "js-yaml";
import * as R from "../scripts/rules.mjs";
import { agreementDoc, buildingDoc, featDoc } from "./build-packs.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const B = Object.fromEntries(yaml.load(fs.readFileSync(path.join(ROOT, "src/packs/buildings.yaml"), "utf8"))
  .map(b => [b.identifier, buildingDoc(b)]));
const F = Object.fromEntries(yaml.load(fs.readFileSync(path.join(ROOT, "src/packs/feats.yaml"), "utf8"))
  .map(f => [f.identifier, featDoc(f)]));

const SELLEMIUS = agreementDoc(yaml.load(fs.readFileSync(path.join(ROOT, "src/packs/agreements.yaml"), "utf8"))[0]);

let n = 0;
function test(name, fn) {
  try {
    fn();
    n++;
    console.log(`ok - ${name}`);
  } catch(err) {
    console.log(`FAIL - ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

const advisors = (filled=true) => Object.fromEntries(["counselor", "magister", "treasurer", "viceroy", "general", "warden", "ruler", "emissary"]
  .map(k => [k, { actorUuid: "", name: filled ? "Someone" : "", away: false, deputy: false }]));

function kingdom(over={}) {
  const system = {
    level: 1, renown: 0, rp: 0, unrest: 0, hunger: 0, week: 1, farmland: 1,
    government: "", setup: { governmentChoice: "", freeChoice: "", heartland: {}, sponsor: {} },
    abilities: {}, asi: {}, advisors: advisors(), tradeAgreements: [], events: [], pendingDice: 0,
    settlements: [{ id: "cap", name: "Capital", size: "village", capital: true, river: false, hills: false }],
    projects: [], army: { upkeep: 0, food: 0 }, usage: {}, builtTypes: [],
    ...over.system
  };
  let i = 0;
  const buildings = (over.buildings ?? []).map(([id, settlement="cap", extra={}]) => ({
    id: `b${i++}`, name: B[id].name, system: { ...B[id].system, settlement, ...extra }
  }));
  const feats = (over.feats ?? []).map(id => ({ id: `f${i++}`, name: F[id].name, system: { ...F[id].system } }));
  const agreements = (over.agreements ?? []).map(sys => ({ id: `a${i++}`, name: "Agreement", system: { ...SELLEMIUS.system, ...sys } }));
  return { system, buildings, feats, agreements };
}

/* ------------------------------------------------------------------ */

test("data: 71 buildings and 30 feats", () => {
  assert.equal(Object.keys(B).length, 71);
  assert.equal(Object.keys(F).length, 30);
});

test("advancement table", () => {
  assert.deepEqual([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(l => R.advancement(l).prof), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  assert.deepEqual([1, 5, 9, 13, 17].map(l => R.advancement(l).dc), [14, 15, 16, 17, 18]);
  assert.deepEqual([1, 3, 4, 7, 8, 11, 12, 15, 16, 20].map(l => R.advancement(l).projects), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});

test("ability scores: government, choices, heartland, sponsor, ASI", () => {
  const k = kingdom({ system: {
    level: 4, government: "despotism",
    setup: { governmentChoice: "loyalty", freeChoice: "stability", heartland: { label: "Forest", ability: "culture", bonus: 1 }, sponsor: { label: "Aldori", ability: "stability", bonus: 1, ability2: "economy", bonus2: -2 } },
    asi: { 4: "stability" }
  } });
  const a = R.abilityScores(k);
  assert.equal(a.stability.total, 10 + 2 + 2 + 1 + 2); // gov, free, sponsor, ASI
  assert.equal(a.economy.total, 10); // +2 government, -2 sponsor
  assert.equal(a.loyalty.total, 12);
  assert.equal(a.culture.total, 11);
  assert.equal(a.stability.mod, 3);
  assert.equal(a.culture.mod, 0);
});

test("ability scores: base capped at 20, buildings on top, vacancies", () => {
  const adv = advisors();
  adv.general.name = "";
  adv.warden.away = true;
  const k = kingdom({ system: { level: 15, abilities: { stability: { adjustment: 15 } }, advisors: adv },
    buildings: [["cathedral"], ["cathedral", "other"]] });
  k.system.settlements.push({ id: "other", name: "Other", size: "village" });
  const a = R.abilityScores(k);
  assert.equal(a.stability.total, 20 + 2 - 4); // cap, Cathedral once, two vacancies
});

test("vacant roles and Town Hall deputy", () => {
  const adv = advisors(false);
  adv.ruler.name = "Kalavani";
  adv.counselor.deputy = true;
  adv.magister.deputy = true; // only one deputy counts
  const k = kingdom({ system: { advisors: adv } });
  assert.equal(R.vacantRoles(k.system, R.deputyAvailable(k)).length, 7);
  const k2 = kingdom({ system: { advisors: adv }, buildings: [["town-hall"]] });
  assert.equal(R.vacantRoles(k2.system, R.deputyAvailable(k2)).length, 6);
  assert.equal(R.deputyRole(k2), "counselor");
});

test("RP dice pool", () => {
  const k = kingdom({
    system: { level: 10, tradeAgreements: [{ name: "Restov", dice: 2 }, { name: "Varnhold", dice: 1 }],
      events: [{ name: "Drought", dice: -1 }], pendingDice: 4 },
    buildings: [["brewery"], ["mine"], ["smithy"], ["lumberyard"], ["stonemason"], ["shrine"]],
    feats: ["thriving-economy", "trade-network"]
  });
  const pool = R.rpDicePool(k);
  // trade 3, brewery 1, mine 2, smithy 1, lumberyard 1, stonemason 1, synergy 3, thriving 2, network 2, event -1, pending 4
  assert.equal(pool.total, 3 + 1 + 2 + 1 + 1 + 1 + 3 + 2 + 2 - 1 + 4);
});

test("Smithy synergy only in the same settlement", () => {
  const k = kingdom({ buildings: [["smithy", "cap"], ["mine", "other"]] });
  k.system.settlements.push({ id: "other", name: "Other", size: "village" });
  assert.equal(R.rpDicePool(k).total, 1 + 2);
});

test("unplaced buildings don't count", () => {
  const k = kingdom({ buildings: [["mine", ""]] });
  assert.equal(R.rpDicePool(k).total, 0);
});

test("Hunger reduction and Hardy Folk", () => {
  assert.equal(R.hungerReduction(kingdom({ system: { hunger: 1 } })), 0.25);
  assert.equal(R.hungerReduction(kingdom({ system: { hunger: 1 }, feats: ["hardy-folk"] })), 0);
  assert.equal(R.hungerReduction(kingdom({ system: { hunger: 2 }, feats: ["hardy-folk"] })), 0.5);
  assert.equal(R.applyHungerToRoll(23, 0.25), 17);
  assert.equal(R.applyHungerToRoll(23, 0.5), 11);
});

test("Food: farmland, buildings, stockyard slaughter, orchard", () => {
  const base = kingdom({ system: { farmland: 2, week: 5 }, buildings: [["mill"], ["stockyard"]] });
  assert.equal(R.foodProduction(base).total, 2 + 1 + 2);
  const slaughter = kingdom({ system: { farmland: 2, week: 5 }, buildings: [["stockyard", "cap", { special: 5 }]] });
  assert.equal(R.foodProduction(slaughter).total, 2 + 6);
  const after = kingdom({ system: { farmland: 2, week: 6 }, buildings: [["stockyard", "cap", { special: 5 }]] });
  assert.equal(R.foodProduction(after).total, 2);
  const orchard = kingdom({ system: { farmland: 5 }, buildings: [["orchard", "cap", { counter: 2 }]] });
  assert.equal(R.foodProduction(orchard).total, 5 + 2);
  const capped = kingdom({ system: { farmland: 5 }, buildings: [["orchard", "cap", { counter: 7 }]] });
  assert.equal(R.foodProduction(capped).total, 5 + 3);
  const cons = kingdom({ system: { army: { food: 2 } } });
  cons.system.settlements.push({ id: "t", name: "Town", size: "town" });
  assert.equal(R.foodConsumption(cons).total, 1 + 3 + 2);
});

test("Hunger steps", () => {
  assert.equal(R.hungerAfter(0, -1), 1);
  assert.equal(R.hungerAfter(3, -5), 3);
  assert.equal(R.hungerAfter(2, 0), 2);
  assert.equal(R.hungerAfter(2, 3), 1);
  assert.equal(R.hungerAfter(0, 3), 0);
});

test("missed petition Unrest scale and Open Door", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => R.missedPetitionUnrest(s)), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
  assert.equal(R.missedPetitionUnrest(1, true), 0);
  assert.equal(R.missedPetitionUnrest(2, true), 1);
});

test("Unrest tiers", () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 14, 15, 30].map(u => R.unrestTier(u).penalty), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual([0, 1, 5, 10, 15].map(u => R.unrestTier(u).surcharge), [0, 0.1, 0.2, 0.3, 0.5]);
});

test("project cost: surcharge and discount", () => {
  const k = kingdom({ system: { unrest: 5 }, buildings: [["library"]] });
  assert.equal(R.projectCost(k, "claimTerritory", 100).final, 96);
  assert.equal(R.projectCost(k, "buildRoad", 25).final, 30);
  const arms = kingdom({ buildings: [["foundry"]] });
  assert.equal(R.projectCost(arms, "masterpiece", 150, { masterpieceKind: "arms" }).final, 120);
  assert.equal(R.projectCost(arms, "masterpiece", 150, { masterpieceKind: "magic" }).final, 150);
  const yard = kingdom({ buildings: [["construction-yard"]] });
  assert.equal(R.projectCost(yard, "buildStructure", 80).final, 64);
  assert.equal(R.projectCost(kingdom({ system: { unrest: 1 } }), "buildStructure", 45).final, 50); // 49.5 rounds up
});

test("project weeks", () => {
  assert.equal(R.projectWeeks("buildStructure", { buildingCost: 80 }), 4);
  assert.equal(R.projectWeeks("buildStructure", { buildingCost: 30 }), 2);
  assert.equal(R.projectWeeks("buildStructure", { buildingCost: 10 }), 1);
  assert.equal(R.projectWeeks("buildRoad", { hexes: 3 }), 3);
  assert.equal(R.projectWeeks("establishFarmland"), 3);
  assert.equal(R.projectWeeks("research"), null);
});

test("project progress: focus, Hunger 3, Master Artisans", () => {
  const k = kingdom();
  assert.equal(R.projectProgress(k, { type: "buildStructure", focus: false }), 1);
  assert.equal(R.projectProgress(k, { type: "buildStructure", focus: true }), 2);
  assert.equal(R.projectProgress(kingdom({ system: { hunger: 3 } }), { type: "buildStructure", focus: true }), 2);
  assert.equal(R.projectStallChance(kingdom({ system: { hunger: 3 } })), 0.5);
  assert.equal(R.projectStallChance(kingdom({ system: { hunger: 2 } })), 0);
  assert.equal(R.projectProgress(kingdom({ feats: ["master-artisans"] }), { type: "masterpiece", focus: true }), 4);
});

test("active projects, Palace and Castle", () => {
  assert.equal(R.maxActiveProjects(kingdom({ system: { level: 4 } })), 2);
  assert.equal(R.maxActiveProjects(kingdom({ system: { level: 15 }, buildings: [["palace"]] })), 5);
  assert.equal(R.maxFocus(kingdom({ buildings: [["castle"]] })), 2);
  const notCapital = kingdom({ buildings: [["castle", "other"]] });
  notCapital.system.settlements.push({ id: "other", name: "Other", size: "village" });
  assert.equal(R.maxFocus(notCapital), 1);
});

test("settlement slots: Paved Streets and Grand Capital", () => {
  const k = kingdom({ buildings: [["paved-streets"], ["town-hall"]], feats: ["grand-capital"] });
  const s = R.settlementSlots(k, k.system.settlements[0]);
  assert.equal(s.total, 9 + 2 + 10);
  assert.equal(s.used, 2);
});

test("building validation", () => {
  const k = kingdom({ system: { level: 3 }, buildings: [["tavern"]] });
  const cap = k.system.settlements[0];
  const v = b => R.validateBuilding(k, { id: null, name: B[b].name, system: B[b].system }, cap);
  assert.equal(v("mill").length, 1);              // needs river
  assert.equal(v("tavern").length, 1);            // duplicate
  assert.equal(v("mine").length, 2);              // level 4 and hills
  assert.equal(v("smithy").length, 0);
  cap.river = true;
  assert.equal(v("mill").length, 0);
  const aq = kingdom({ system: { level: 7 }, buildings: [["aqueduct"]] });
  assert.equal(R.validateBuilding(aq, { id: null, name: "Mill", system: B.mill.system }, aq.system.settlements[0]).length, 0);
  const pal = kingdom({ system: { level: 15 } });
  pal.system.settlements.push({ id: "o", name: "O", size: "village", capital: false });
  assert.equal(R.validateBuilding(pal, { id: null, name: "Palace", system: B.palace.system }, pal.system.settlements[1]).length, 1);
});

test("Renown and levels", () => {
  assert.deepEqual(R.pendingLevels(1, 12), { gained: 2, level: 3, renown: 2 });
  assert.deepEqual(R.pendingLevels(4, 13), { gained: 2, level: 6, renown: 0 });
  assert.equal(R.renownNeeded(10), 12);
  assert.equal(R.renownNeeded(20), null);
  assert.equal(R.featSlots(1), 0);
  assert.equal(R.featSlots(9), 4);
  assert.equal(R.featSlots(20), 10);
  assert.equal(R.settlementsAllowed(1), 1);
  assert.equal(R.settlementsAllowed(7), 3);
  assert.equal(R.settlementsAllowed(20), 6);
});

test("usage tracking", () => {
  assert.equal(R.isAvailable({}, "x", "week", 3), true);
  assert.equal(R.isAvailable({ x: 3 }, "x", "week", 3), false);
  assert.equal(R.isAvailable({ x: 3 }, "x", "week", 4), true);
  assert.equal(R.isAvailable({ x: 3 }, "x", "fourWeeks", 6), false);
  assert.equal(R.isAvailable({ x: 3 }, "x", "fourWeeks", 7), true);
  assert.equal(R.weeksUntilAvailable({ x: 3 }, "x", "fourWeeks", 5), 2);
});

test("menagerie income and guildhall", () => {
  const k = kingdom({ system: { level: 12 }, buildings: [["menagerie", "cap", { counter: 6 }], ["guildhall"]] });
  assert.equal(R.rpFlatIncome(k).total, 20);
  assert.equal(R.guildhallRerolls(k), 4);
});

test("check bonuses: University, Inspiring Entertainment", () => {
  const k = kingdom({ system: { unrest: 5 }, buildings: [["university"]], feats: ["inspiring-entertainment"] });
  assert.equal(R.checkBonuses(k, "culture").reduce((t, b) => t + b.value, 0), 3);
  assert.equal(R.checkBonuses(k, "loyalty").reduce((t, b) => t + b.value, 0), 1);
});

test("agreement: surcharge only on Build Structure, adds to Unrest surcharge", () => {
  const signed = { signedWeek: 1, debt: 100, periodStart: 1 };
  const k = kingdom({ system: { unrest: 1 }, agreements: [signed] });
  assert.equal(R.projectCost(k, "buildStructure", 40).final, 52); // 40 x 1.30
  assert.equal(R.projectCost(k, "buildRoad", 25).final, 28);      // Unrest only
  const yard = kingdom({ buildings: [["construction-yard"]], agreements: [signed] });
  assert.equal(R.projectCost(yard, "buildStructure", 80).final, 77); // 80 x 1.2 x 0.8 = 76.8
  const repaid = kingdom({ agreements: [{ signedWeek: 1, debt: 0 }] });
  assert.equal(R.projectCost(repaid, "buildStructure", 40).final, 40);
  const unsigned = kingdom({ agreements: [{ signedWeek: null, debt: 100 }] });
  assert.equal(R.projectCost(unsigned, "buildStructure", 40).final, 40);
});

test("agreement: monthly minimum and missed payments", () => {
  const a = sys => ({ name: "A", system: { ...SELLEMIUS.system, signedWeek: 1, periodStart: 1, debt: 100, ...sys } });
  assert.equal(R.agreementPeriodEnd(a({})), 4);
  assert.equal(R.agreementWeekEnd(a({}), 3), null);
  assert.deepEqual(R.agreementWeekEnd(a({ paidThisPeriod: 2 }), 4), { missed: true, surcharge: 25, periodStart: 5 });
  assert.deepEqual(R.agreementWeekEnd(a({ paidThisPeriod: 5 }), 4), { missed: false, surcharge: 20, periodStart: 5 });
  assert.deepEqual(R.agreementWeekEnd(a({ surcharge: 25, paidThisPeriod: 0, periodStart: 5 }), 8), { missed: true, surcharge: 30, periodStart: 9 });
  // Less than the minimum left: paying it all counts
  assert.equal(R.agreementMinimumDue(a({ debt: 0, paidThisPeriod: 3 })), 0);
  assert.equal(R.agreementMinimumDue(a({ debt: 2, paidThisPeriod: 0 })), 2);
  assert.equal(R.agreementWeekEnd(a({ debt: 0 }), 4), null);
});

console.log(`\n${n} tests passed${process.exitCode ? ", some FAILED" : ""}`);
