/**
 * Build the compendium packs from src/packs/*.yaml.
 * Usage: node tools/build-packs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as yaml from "js-yaml";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MODULE_ID = "kingdom-simplified";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Stable 16-character Foundry id derived from a string. */
export function stableId(seed) {
  const bytes = crypto.createHash("sha256").update(seed).digest();
  let id = "";
  for ( let i = 0; i < 16; i++ ) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

const html = text => (Array.isArray(text) ? text : [text]).map(p => `<p>${p}</p>`).join("");

export function buildingDoc(b) {
  const _id = stableId(`building.${b.identifier}`);
  return {
    _id,
    _key: `!items!${_id}`,
    name: b.name,
    type: `${MODULE_ID}.building`,
    img: `modules/${MODULE_ID}/icons/building.svg`,
    system: {
      identifier: b.identifier,
      level: b.level ?? 1,
      slots: b.slots ?? 1,
      cost: b.cost ?? 0,
      rpDice: b.rpDice ?? 0,
      food: b.food ?? 0,
      ability: { key: b.ability?.key ?? "", value: b.ability?.value ?? 0 },
      discounts: (b.discounts ?? []).map(key => ({ key, percent: 20 })),
      requires: { river: !!b.requires?.river, hills: !!b.requires?.hills, capital: !!b.requires?.capital },
      slotBonus: b.slotBonus ?? 0,
      unrestOnBuild: b.unrestOnBuild ?? 0,
      unrestFirstBuild: b.unrestFirstBuild ?? 0,
      clearsUnrest: !!b.clearsUnrest,
      perk: { frequency: b.perk?.frequency ?? "none", label: b.perk?.label ?? "" },
      description: html(b.text),
      settlement: "",
      counter: 0,
      special: null
    },
    effects: [],
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    flags: {}
  };
}

export function featDoc(f) {
  const _id = stableId(`feat.${f.identifier}`);
  return {
    _id,
    _key: `!items!${_id}`,
    name: f.name,
    type: `${MODULE_ID}.feat`,
    img: `modules/${MODULE_ID}/icons/feat.svg`,
    system: {
      identifier: f.identifier,
      prerequisite: f.prerequisite ?? 0,
      repeatable: !!f.repeatable,
      ability: "",
      perk: { frequency: f.perk?.frequency ?? "none", label: f.perk?.label ?? "" },
      description: html(f.text)
    },
    effects: [],
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    flags: {}
  };
}

export function agreementDoc(a) {
  const _id = stableId(`agreement.${a.identifier}`);
  return {
    _id,
    _key: `!items!${_id}`,
    name: a.name,
    type: `${MODULE_ID}.agreement`,
    img: `modules/${MODULE_ID}/icons/agreement.svg`,
    system: {
      identifier: a.identifier,
      partner: a.partner ?? "",
      loan: a.loan ?? 0,
      repayTotal: a.repayTotal ?? a.loan ?? 0,
      surcharge: a.surcharge ?? 0,
      surchargeStep: a.surchargeStep ?? 0,
      minPayment: a.minPayment ?? 0,
      periodWeeks: a.periodWeeks ?? 4,
      description: html(a.text),
      signedWeek: null, debt: 0, periodStart: null, paidThisPeriod: 0, missed: 0
    },
    effects: [],
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    flags: {}
  };
}

/** A compendium folder document. */
function folderDoc(pack, label, sort) {
  const _id = stableId(`folder.${pack}.${label}`);
  return {
    _id, _key: `!folders!${_id}`, name: label, type: "Item", folder: null,
    sorting: "a", sort, color: null, description: "", flags: {}
  };
}

/** Folder label for an entry: by building level or feat prerequisite. */
function levelOf(name, entry) {
  return name === "buildings" ? (entry.level ?? 1) : (entry.prerequisite ?? 0);
}
// Foundry sorts compendium folders alphabetically by default, so pad the number (Level 02 before Level 10).
function folderLabel(name, level) {
  if ( (name === "feats") && !level ) return "Any level";
  return `Level ${String(level).padStart(2, "0")}`;
}

async function build(name, toDoc, { levelFolders=true }={}) {
  const data = yaml.load(fs.readFileSync(path.join(ROOT, "src/packs", `${name}.yaml`), "utf8"));
  const tmp = path.join(ROOT, "src/packs/_json", name);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const seen = new Set();
  const levels = levelFolders ? [...new Set(data.map(e => levelOf(name, e)))].sort((a, b) => a - b) : [];
  const folders = new Map(levels.map((l, i) => [l, folderDoc(name, folderLabel(name, l), (i + 1) * 100)]));
  for ( const f of folders.values() ) fs.writeFileSync(path.join(tmp, `_folder-${f._id}.json`), JSON.stringify(f, null, 2));
  data.forEach((entry, i) => {
    if ( seen.has(entry.identifier) ) throw new Error(`Duplicate identifier ${entry.identifier}`);
    seen.add(entry.identifier);
    const doc = toDoc(entry);
    doc.sort = (i + 1) * 100;
    doc.folder = folders.get(levelOf(name, entry))?._id ?? null;
    fs.writeFileSync(path.join(tmp, `${entry.identifier}.json`), JSON.stringify(doc, null, 2));
  });
  const dest = path.join(ROOT, "packs", name);
  fs.rmSync(dest, { recursive: true, force: true });
  await compilePack(tmp, dest, { log: false });
  console.log(`${name}: ${data.length} entries in ${folders.size} folders (${[...folders.values()].map(f => f.name).join(", ")}) -> packs/${name}`);
  return data.length;
}

if ( import.meta.url === `file://${process.argv[1]}` ) {
  await build("buildings", buildingDoc);
  await build("feats", featDoc);
  await build("agreements", agreementDoc, { levelFolders: false });
}
