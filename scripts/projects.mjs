/**
 * Projects: starting, cost, progress and completion.
 */
import { MASTERPIECE, MODULE_ID, PROJECT_TYPES, SETTLEMENT_SIZES, TYPES } from "./config.mjs";
import * as R from "./rules.mjs";
import {
  available, chat, escape, logUpdate, notifyLevelUp, placeBuilding, renownUpdate, unrestChange, useUpdate, waitDialog
} from "./kingdom-api.mjs";

const { DialogV2 } = foundry.applications.api;

/** All buildings from the module compendium (plus world items), as plain data. */
export async function buildingCatalog() {
  const out = [];
  const pack = game.packs.get(`${MODULE_ID}.buildings`);
  if ( pack ) {
    const docs = await pack.getDocuments();
    for ( const d of docs ) out.push({ uuid: d.uuid, name: d.name, system: d.system });
  }
  for ( const d of game.items.filter(i => i.type === TYPES.building) ) {
    out.push({ uuid: d.uuid, name: `${d.name} (world)`, system: d.system });
  }
  return out.sort((a, b) => (a.system.level - b.system.level) || a.name.localeCompare(b.name));
}

/**
 * Open the New Project dialog.
 * @param {Actor} actor
 * @param {object} [preset]  { type, settlement, buildingUuid }
 */
export async function newProjectDialog(actor, preset={}) {
  const sys = actor.system;
  const snap = sys.snapshot;
  const active = sys.projects.length;
  const max = R.maxActiveProjects(snap);
  if ( active >= max ) {
    ui.notifications.warn(`Your kingdom already has ${active} of ${max} active project(s).`);
    return;
  }
  const catalog = await buildingCatalog();
  const settlements = sys.settlements;
  const mansion = R.hasBuilding(snap, "mansion") && available(actor, "mansion", "fourWeeks");
  const opt = (v, l, sel) => `<option value="${escape(v)}" ${sel ? "selected" : ""}>${escape(l)}</option>`;
  const settlementOptions = settlements.map(s => opt(s.id, `${s.name} (${SETTLEMENT_SIZES[s.size]?.label})`, s.id === preset.settlement)).join("");
  const buildingOptions = catalog.map(b => opt(b.uuid,
    `L${b.system.level} ${b.name} — ${b.system.cost} RP, ${b.system.slots} slot${b.system.slots === 1 ? "" : "s"}${b.system.level > sys.level ? " (level too low)" : ""}`,
    b.uuid === preset.buildingUuid)).join("");

  const content = `
  <div class="ks-project-dialog">
    <div class="form-group">
      <label>Project</label>
      <select name="type">${Object.entries(PROJECT_TYPES).map(([k, p]) => opt(k, p.label, k === (preset.type ?? "buildStructure"))).join("")}</select>
    </div>
    <div class="form-group" data-show="buildStructure expandSettlement">
      <label>Settlement</label>
      <select name="settlement">${settlementOptions}</select>
    </div>
    <div class="form-group" data-show="buildStructure">
      <label>Building</label>
      <select name="building">${buildingOptions}</select>
    </div>
    <div class="form-group" data-show="buildRoad">
      <label>Hexes</label>
      <input type="number" name="hexes" min="1" value="1">
    </div>
    <div class="form-group" data-show="masterpiece">
      <label>Rarity</label>
      <select name="rarity">${Object.entries(MASTERPIECE).map(([k, m]) => opt(k, `${m.label} — ${m.cost} RP${m.level > 1 ? ` (level ${m.level}+)` : ""}`, k === "uncommon")).join("")}</select>
    </div>
    <div class="form-group" data-show="masterpiece">
      <label>Item kind</label>
      <select name="kind">${opt("arms", "Weapon or armor", true)}${opt("magic", "Other magic item")}</select>
    </div>
    <div class="form-group" data-show="masterpiece claimTerritory research infiltration sendEnvoy buildRoad">
      <label>Name / target</label>
      <input type="text" name="name" placeholder="e.g. Clear the Narlmarches hex">
    </div>
    <div class="form-group" data-show="claimTerritory research infiltration sendEnvoy">
      <label>Base RP cost (DM)</label>
      <input type="number" name="baseCost" min="0" value="0">
    </div>
    <div class="form-group" data-show="expandSettlement masterpiece claimTerritory research infiltration sendEnvoy">
      <label>Weeks (DM)</label>
      <input type="number" name="weeks" min="1" value="2">
    </div>
    ${mansion ? `<div class="form-group"><label>Mansion pays up to 50 RP (+2 Unrest)</label><input type="checkbox" name="mansion"></div>` : ""}
    <div class="ks-cost-preview"></div>
  </div>`;

  // Live preview of cost and duration.
  const compute = form => {
    const f = form.elements;
    const type = f.type.value;
    const out = { type, errors: [], warnings: [] };
    const settlement = settlements.find(s => s.id === f.settlement?.value);
    if ( type === "buildStructure" ) {
      const b = catalog.find(c => c.uuid === f.building.value);
      if ( !settlement ) out.errors.push("Add a settlement first.");
      if ( !b ) out.errors.push("Pick a building.");
      if ( b && settlement ) {
        out.warnings.push(...R.validateBuilding(snap, { name: b.name, system: b.system }, settlement));
        out.base = b.system.cost;
        out.weeks = R.projectWeeks(type, { buildingCost: b.system.cost });
        out.name = `${b.name} in ${settlement.name}`;
        out.building = b;
        out.settlement = settlement.id;
      }
    } else if ( type === "buildRoad" ) {
      const hexes = Math.max(Number(f.hexes.value) || 1, 1);
      out.base = hexes * PROJECT_TYPES.buildRoad.costPerHex;
      out.weeks = hexes;
      out.hexes = hexes;
      out.name = f.name.value || `Road (${hexes} hex${hexes > 1 ? "es" : ""})`;
    } else if ( type === "establishFarmland" ) {
      out.base = PROJECT_TYPES.establishFarmland.cost;
      out.weeks = PROJECT_TYPES.establishFarmland.weeks;
      out.name = "Farmland";
    } else if ( type === "expandSettlement" ) {
      if ( !settlement ) out.errors.push("Pick a settlement.");
      else {
        const next = R.nextSize(settlement.size);
        if ( !next ) out.errors.push(`${settlement.name} is already a Metropolis.`);
        else {
          if ( !R.sizeUnlocked(next, sys.level) ) out.warnings.push(`${SETTLEMENT_SIZES[next].label} needs kingdom level ${SETTLEMENT_SIZES[next].level}.`);
          out.base = SETTLEMENT_SIZES[next].expandCost;
          out.name = `${settlement.name} → ${SETTLEMENT_SIZES[next].label}`;
          out.settlement = settlement.id;
        }
      }
      out.weeks = Math.max(Number(f.weeks.value) || 1, 1);
    } else if ( type === "masterpiece" ) {
      const m = MASTERPIECE[f.rarity.value];
      if ( m.level > sys.level ) out.warnings.push(`${m.label} masterpieces need kingdom level ${m.level}.`);
      out.base = m.cost;
      out.kind = f.kind.value;
      out.weeks = Math.max(Number(f.weeks.value) || 1, 1);
      out.name = f.name.value || `${m.label} masterpiece`;
    } else {
      out.base = Math.max(Number(f.baseCost.value) || 0, 0);
      out.weeks = Math.max(Number(f.weeks.value) || 1, 1);
      out.name = f.name.value || PROJECT_TYPES[type].label;
    }
    if ( out.base !== undefined ) {
      out.cost = R.projectCost(snap, type, out.base, { masterpieceKind: out.kind });
      out.mansion = !!f.mansion?.checked;
      out.pay = Math.max(out.cost.final - (out.mansion ? 50 : 0), 0);
      if ( out.pay > sys.rp ) out.errors.push(`The kingdom has ${sys.rp} RP; this costs ${out.pay}.`);
    }
    return out;
  };

  const render = (dialog, form) => {
    const update = () => {
      const type = form.elements.type.value;
      for ( const el of form.querySelectorAll("[data-show]") ) {
        el.style.display = el.dataset.show.split(" ").includes(type) ? "" : "none";
      }
      const r = compute(form);
      const preview = form.querySelector(".ks-cost-preview");
      const c = r.cost;
      preview.innerHTML = `${c ? `<p><strong>Cost: ${r.pay} RP</strong> (base ${c.base}${c.surcharge ? `, +${Math.round(c.surcharge * 100)}% Unrest` : ""}${(c.agreementParts ?? []).map(p => `, +${p.value}% ${escape(p.label)}`).join("")}${c.discount ? `, −${Math.round(c.discount * 100)}% ${escape(c.discountSource)}` : ""}${r.mansion ? ", Mansion pays up to 50" : ""}) · ${r.weeks} week(s) at normal progress</p>` : ""}
        ${r.warnings.map(w => `<p class="ks-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${escape(w)}</p>`).join("")}
        ${r.errors.map(w => `<p class="ks-error"><i class="fa-solid fa-circle-xmark"></i> ${escape(w)}</p>`).join("")}
        <p class="hint">Kingdom RP: ${sys.rp}</p>`;
    };
    form.addEventListener("change", update);
    form.addEventListener("input", update);
    update();
  };

  const result = await waitDialog({
    window: { title: "New project" },
    position: { width: 520 },
    content,
    buttons: [{
      action: "start", label: "Start project", default: true, icon: "fa-solid fa-hammer",
      callback: (event, button) => compute(button.form)
    }, { action: "cancel", label: "Cancel" }],
    rejectClose: false
  }, render);
  if ( !result || (result === "cancel") ) return;
  if ( result.errors.length ) {
    ui.notifications.error(result.errors.join(" "));
    return;
  }
  if ( result.warnings.length ) {
    const ok = await DialogV2.confirm({
      window: { title: "Start anyway?" },
      content: `<ul>${result.warnings.map(w => `<li>${escape(w)}</li>`).join("")}</ul><p>Start the project anyway?</p>`
    });
    if ( !ok ) return;
  }
  return startProject(actor, result);
}

/**
 * Pay for and add a project.
 */
export async function startProject(actor, r) {
  const sys = actor.system;
  const project = {
    id: foundry.utils.randomID(),
    type: r.type,
    name: r.name,
    cost: r.pay,
    weeksNeeded: r.weeks ?? null,
    weeksDone: 0,
    focus: false,
    settlement: r.settlement ?? "",
    buildingUuid: r.building?.uuid ?? "",
    hexes: r.hexes ?? 1,
    notes: r.kind ? (r.kind === "arms" ? "Weapon or armor" : "Magic item") : ""
  };
  const projects = [...sys.projects.map(p => ({ ...p })), project];
  if ( projects.length === 1 ) project.focus = true;
  const updates = { "system.projects": projects, "system.rp": sys.rp - r.pay };
  let text = `Started ${PROJECT_TYPES[r.type].label}: ${r.name} (−${r.pay} RP, ${r.weeks} week(s))`;
  if ( r.mansion ) {
    useUpdate(actor, "mansion", updates);
    const { delta } = unrestChange(actor, 2, {}, updates);
    text += `. Mansion paid ${Math.min(50, r.cost.final)} RP: +${delta} Unrest`;
  }
  logUpdate(actor, text, updates);
  await actor.update(updates);
  return chat(actor, `<p><strong>${escape(actor.name)}</strong> starts a project: ${escape(r.name)} (${r.pay} RP, ${r.weeks} week(s)).</p>`);
}

export async function updateProject(actor, id, changes) {
  const projects = actor.system.projects.map(p => (p.id === id ? { ...p, ...changes } : { ...p }));
  return actor.update({ "system.projects": projects });
}

export async function toggleFocus(actor, id) {
  const sys = actor.system;
  const max = R.maxFocus(sys.snapshot);
  const projects = sys.projects.map(p => ({ ...p }));
  const target = projects.find(p => p.id === id);
  if ( !target ) return;
  if ( target.focus ) target.focus = false;
  else {
    const focused = projects.filter(p => p.focus);
    if ( focused.length >= max ) focused[0].focus = false;
    target.focus = true;
  }
  return actor.update({ "system.projects": projects });
}

export async function cancelProject(actor, id) {
  const p = actor.system.projects.find(p => p.id === id);
  if ( !p ) return;
  const ok = await DialogV2.confirm({
    window: { title: "Cancel project" },
    content: `<p>Cancel <strong>${escape(p.name)}</strong>? The ${p.cost} RP already paid is not refunded.</p>`
  });
  if ( !ok ) return;
  const updates = { "system.projects": actor.system.projects.filter(x => x.id !== id) };
  logUpdate(actor, `Cancelled project: ${p.name}`, updates);
  return actor.update(updates);
}

/**
 * Complete a project and apply its results.
 * @param {Actor} actor
 * @param {string} id
 * @param {object} [updates]  Pending updates to merge into. When given, the caller saves them.
 * @returns {Promise<string[]>} Lines describing what happened.
 */
export async function completeProject(actor, id, updates=null) {
  const save = updates === null;
  updates ??= {};
  const sys = actor.system;
  const p = (updates["system.projects"] ?? sys.projects).find(x => x.id === id);
  if ( !p ) return [];
  const lines = [`Completed: ${p.name}`];
  const cfg = PROJECT_TYPES[p.type];

  switch ( p.type ) {
    case "buildStructure": {
      const doc = p.buildingUuid ? await fromUuid(p.buildingUuid) : null;
      if ( doc ) {
        const { lines: l } = await placeBuilding(actor, doc.toObject(), p.settlement, { effects: true }, updates);
        lines.push(...l.slice(1));
      } else lines.push("The building's source item is missing; add it to the settlement by hand.");
      break;
    }
    case "establishFarmland":
      updates["system.farmland"] = (updates["system.farmland"] ?? sys.farmland) + 1;
      lines.push("Farmland +1");
      break;
    case "expandSettlement": {
      const settlements = (updates["system.settlements"] ?? sys.settlements).map(s => ({ ...s }));
      const s = settlements.find(x => x.id === p.settlement);
      const next = s ? R.nextSize(s.size) : null;
      if ( s && next ) {
        s.size = next;
        updates["system.settlements"] = settlements;
        lines.push(`${s.name} is now a ${SETTLEMENT_SIZES[next].label}`);
      }
      break;
    }
  }
  if ( cfg?.growingPains ) {
    const { delta, notes } = unrestChange(actor, 1, {}, updates);
    lines.push(`Growing Pains: +${delta} Unrest${notes.length ? ` (${notes.join("; ")})` : ""}`);
  }
  if ( cfg?.renown === true ) {
    const { amount } = renownUpdate(actor, 1, `Completed ${p.name}`, {}, updates);
    lines.push(`+${amount} Renown`);
  }
  updates["system.projects"] = (updates["system.projects"] ?? sys.projects).filter(x => x.id !== id).map(x => ({ ...x }));
  logUpdate(actor, lines.join(". "), updates);
  if ( save ) {
    await actor.update(updates);
    notifyLevelUp(actor);
    await chat(actor, `<p>${lines.map(escape).join("<br>")}</p>`);
  }
  return lines;
}
