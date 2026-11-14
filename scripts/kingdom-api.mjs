/**
 * Foundry-side helpers that change a kingdom actor: Unrest, RP, Renown, usage, buildings, log.
 */
import { RESOURCE_PURCHASE, TYPES } from "./config.mjs";
import * as R from "./rules.mjs";

const { DialogV2 } = foundry.applications.api;

/* -------------------------------------------- */
/*  Small utilities                             */
/* -------------------------------------------- */

export function isKingdom(actor) {
  return actor?.type === TYPES.kingdom;
}

export function escape(text) {
  return foundry.utils.escapeHTML(String(text ?? ""));
}

/** Post a short kingdom message to chat. */
export async function chat(actor, html, { whisperGM=false }={}) {
  const data = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="ks-chat">${html}</div>`
  };
  if ( whisperGM ) data.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
  return ChatMessage.create(data);
}

/** Add a line to the kingdom log (kept to the last 200 entries). */
export function logUpdate(actor, text, updates={}) {
  const log = [...(updates["system.log"] ?? actor.system.log), { week: actor.system.week, text }];
  updates["system.log"] = log.slice(-200);
  return updates;
}

export async function addLog(actor, text) {
  return actor.update(logUpdate(actor, text));
}

/* -------------------------------------------- */
/*  Usage                                       */
/* -------------------------------------------- */

export function available(actor, key, frequency) {
  return R.isAvailable(actor.system.usage, key, frequency, actor.system.week);
}

export function useUpdate(actor, key, updates={}) {
  updates[`system.usage.${key}`] = actor.system.week;
  return updates;
}

export async function markUsed(actor, key, used=true) {
  if ( used ) return actor.update({ [`system.usage.${key}`]: actor.system.week });
  return actor.update({ [`system.usage.-=${key}`]: null });
}

/* -------------------------------------------- */
/*  Unrest, RP, Renown                          */
/* -------------------------------------------- */

/**
 * Work out an Unrest change, applying Grand Tavern holiday and Festival Hall.
 * @param {Actor} actor
 * @param {number} delta
 * @param {object} [options]
 * @param {boolean} [options.fromEvent]   Unrest from a kingdom event (Festival Hall applies).
 * @param {object} [updates]              Pending update object to merge into.
 * @returns {{delta: number, notes: string[], updates: object}}
 */
export function unrestChange(actor, delta, { fromEvent=false }={}, updates={}) {
  const sys = actor.system;
  const notes = [];
  let d = Number(delta) || 0;
  if ( (d > 0) && (sys.holidayWeek === sys.week) ) {
    notes.push(`Holiday: ${d} Unrest ignored`);
    d = 0;
  }
  if ( (d > 0) && fromEvent && R.hasBuilding(actor.system.snapshot, "festival-hall")
    && R.isAvailable(sys.usage, "festival-hall", "week", sys.week) && !updates["system.usage.festival-hall"] ) {
    d -= 1;
    notes.push("Festival Hall: −1 Unrest");
    updates["system.usage.festival-hall"] = sys.week;
  }
  const current = updates["system.unrest"] ?? sys.unrest;
  updates["system.unrest"] = Math.max(current + d, 0);
  return { delta: d, notes, updates };
}

export async function changeUnrest(actor, delta, reason, options={}) {
  const { delta: d, notes, updates } = unrestChange(actor, delta, options);
  const text = `${reason}: ${d >= 0 ? "+" : ""}${d} Unrest${notes.length ? ` (${notes.join("; ")})` : ""}`;
  logUpdate(actor, text, updates);
  await actor.update(updates);
  return d;
}

export async function changeRp(actor, delta, reason) {
  const rp = Math.max(actor.system.rp + delta, 0);
  const updates = { "system.rp": rp };
  logUpdate(actor, `${reason}: ${delta >= 0 ? "+" : ""}${delta} RP`, updates);
  return actor.update(updates);
}

/**
 * Grant Renown, applying Theater and Famed Realm.
 * @param {Actor} actor
 * @param {number} amount
 * @param {string} reason
 * @param {object} [options]
 * @param {boolean} [options.milestone]  Major event, crisis or story milestone (Famed Realm).
 * @param {object} [updates]             Pending update object to merge into.
 * @returns {{amount: number, notes: string[]}}
 */
export function renownUpdate(actor, amount, reason, { milestone=false }={}, updates={}) {
  const sys = actor.system;
  const snap = sys.snapshot;
  const notes = [];
  let n = Number(amount) || 0;
  if ( n <= 0 ) return { amount: 0, notes };
  if ( milestone && R.hasFeat(snap, "famed-realm") ) {
    n += 1;
    notes.push("Famed Realm +1");
  }
  const lastWeek = updates["system.lastRenownWeek"] ?? sys.lastRenownWeek;
  if ( R.hasBuilding(snap, "theater") && (lastWeek !== sys.week) ) {
    n += 1;
    notes.push("Theater +1");
  }
  updates["system.lastRenownWeek"] = sys.week;
  updates["system.renown"] = (updates["system.renown"] ?? sys.renown) + n;
  logUpdate(actor, `${reason}: +${n} Renown${notes.length ? ` (${notes.join("; ")})` : ""}`, updates);
  return { amount: n, notes };
}

export async function gainRenown(actor, amount, reason, options={}) {
  const updates = {};
  const result = renownUpdate(actor, amount, reason, options, updates);
  await actor.update(updates);
  notifyLevelUp(actor);
  return result;
}

export function notifyLevelUp(actor) {
  const { gained } = R.pendingLevels(actor.system.level, actor.system.renown);
  if ( gained ) ui.notifications.info(`${actor.name} has enough Renown to gain a level. Use Level Up on the kingdom sheet.`);
}

/** Spend Renown to gain one level, if there's enough. */
export async function levelUp(actor) {
  const sys = actor.system;
  const need = R.renownNeeded(sys.level);
  if ( (need === null) || (sys.renown < need) ) {
    ui.notifications.warn("Not enough Renown to gain a level.");
    return null;
  }
  const level = sys.level + 1;
  const updates = { "system.level": level, "system.renown": sys.renown - need };
  const features = R.advancement(level).features;
  logUpdate(actor, `Reached kingdom level ${level}${features.length ? ` (${features.join(", ")})` : ""}`, updates);
  await actor.update(updates);
  await chat(actor, `<h3>${escape(actor.name)} reaches level ${level}</h3>
    <p>Proficiency +${R.advancement(level).prof}, Kingdom DC ${R.advancement(level).dc}, ${R.advancement(level).projects} active project(s).</p>
    ${features.length ? `<p><strong>New:</strong> ${features.map(escape).join(", ")}</p>` : ""}`);
  return level;
}

/* -------------------------------------------- */
/*  Settlements & buildings                     */
/* -------------------------------------------- */

export async function addSettlement(actor) {
  const sys = actor.system;
  const allowed = R.settlementsAllowed(sys.level);
  if ( sys.settlements.length >= allowed ) {
    const ok = await DialogV2.confirm({
      window: { title: "Add settlement" },
      content: `<p>At level ${sys.level} your kingdom is allowed ${allowed} settlement(s) and already has ${sys.settlements.length}. Add one anyway?</p>`
    });
    if ( !ok ) return;
  }
  const settlements = [...sys.settlements.map(s => s.toObject?.() ?? { ...s })];
  const first = settlements.length === 0;
  settlements.push({
    id: foundry.utils.randomID(), name: first ? "Capital" : "New settlement",
    size: "village", capital: first, river: false, hills: false, notes: ""
  });
  const updates = { "system.settlements": settlements };
  if ( first ) {
    logUpdate(actor, "Founded the first settlement", updates);
    return actor.update(updates);
  }
  // Growing Pains
  unrestChange(actor, 1, {}, updates);
  logUpdate(actor, "New settlement founded: +1 Unrest (Growing Pains)", updates);
  return actor.update(updates);
}

export async function updateSettlement(actor, id, changes) {
  const settlements = actor.system.settlements.map(s => {
    const obj = { ...s };
    if ( s.id !== id ) {
      if ( changes.capital ) obj.capital = false;
      return obj;
    }
    return { ...obj, ...changes };
  });
  return actor.update({ "system.settlements": settlements });
}

export async function deleteSettlement(actor, id) {
  const s = actor.system.settlements.find(s => s.id === id);
  if ( !s ) return;
  const buildings = actor.items.filter(i => (i.type === TYPES.building) && (i.system.settlement === id));
  const ok = await DialogV2.confirm({
    window: { title: `Remove ${s.name}` },
    content: `<p>Remove <strong>${escape(s.name)}</strong>${buildings.length ? ` and its ${buildings.length} building(s)` : ""}? This can't be undone.</p>`
  });
  if ( !ok ) return;
  if ( buildings.length ) await actor.deleteEmbeddedDocuments("Item", buildings.map(b => b.id));
  return actor.update({ "system.settlements": actor.system.settlements.filter(x => x.id !== id) });
}

/**
 * Put a building into a settlement as finished, applying its build effects.
 * @param {Actor} actor
 * @param {object} itemData     Item source data of the building.
 * @param {string} settlementId
 * @param {object} [options]
 * @param {boolean} [options.effects=true]  Apply Unrest/Renown effects of building it.
 * @param {object} [updates]    Pending actor updates to merge into (not saved here when given).
 * @returns {Promise<{item: Item|null, lines: string[]}>}
 */
export async function placeBuilding(actor, itemData, settlementId, { effects=true }={}, updates=null) {
  const save = updates === null;
  updates ??= {};
  const lines = [];
  const data = foundry.utils.deepClone(itemData);
  delete data._id;
  data.system ??= {};
  data.system.settlement = settlementId;
  // Orchard: Farmland hexes next to it (editable on the sheet); start from what the kingdom has, max 3.
  data.system.counter = data.system.identifier === "orchard" ? Math.min(Number(actor.system.farmland) || 0, 3) : 0;
  data.system.special = null;
  const sys = actor.system;
  const settlement = sys.settlements.find(s => s.id === settlementId);
  const identifier = data.system.identifier;

  // Stone Wall replaces Wooden Wall.
  if ( identifier === "stone-wall" ) {
    const wooden = actor.items.filter(i => (i.type === TYPES.building) && (i.system.settlement === settlementId)
      && (i.system.identifier === "wooden-wall"));
    if ( wooden.length ) {
      await actor.deleteEmbeddedDocuments("Item", wooden.map(w => w.id));
      lines.push("Stone Wall replaces the Wooden Wall");
    }
  }

  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  lines.unshift(`${data.name} built in ${settlement?.name ?? "a settlement"}`);

  // Record the type as built either way, so a later copy doesn't count as the first one.
  const builtTypes = updates["system.builtTypes"] ?? [...sys.builtTypes];
  const first = !!identifier && !builtTypes.includes(identifier);
  if ( first ) {
    builtTypes.push(identifier);
    updates["system.builtTypes"] = builtTypes;
  }

  if ( effects ) {
    if ( data.system.clearsUnrest ) {
      updates["system.unrest"] = 0;
      lines.push("Unrest drops to 0");
    }
    let unrest = Number(data.system.unrestOnBuild) || 0;
    if ( first ) unrest += Number(data.system.unrestFirstBuild) || 0;
    if ( unrest && !data.system.clearsUnrest ) {
      const { delta, notes } = unrestChange(actor, unrest, {}, updates);
      lines.push(`${delta >= 0 ? "+" : ""}${delta} Unrest${notes.length ? ` (${notes.join("; ")})` : ""}`);
    }
    if ( first ) {
      const { amount } = renownUpdate(actor, 1, `First ${data.name}`, {}, updates);
      lines.push(`+${amount} Renown (first ${data.name})`);
      if ( identifier === "university" ) lines.push("University: choose one additional kingdom feat");
    }
  }
  logUpdate(actor, lines.join(". "), updates);
  if ( save ) {
    await actor.update(updates);
    notifyLevelUp(actor);
  }
  return { item, lines };
}

/* -------------------------------------------- */
/*  Buying resources and the Bank               */
/* -------------------------------------------- */

export function purchaseInfo(actor) {
  const sys = actor.system;
  const bank = R.hasBuilding(sys.snapshot, "bank");
  const rate = bank ? RESOURCE_PURCHASE.bankGpPerRp : RESOURCE_PURCHASE.gpPerRp;
  const bought = sys.resourcesBought.week === sys.week ? sys.resourcesBought.amount : 0;
  return { rate, bought, remaining: Math.max(RESOURCE_PURCHASE.maxPerWeek - bought, 0) };
}

export async function buyResources(actor) {
  const { rate, remaining } = purchaseInfo(actor);
  if ( !remaining ) return ui.notifications.warn("Your kingdom has already bought 50 RP this week.");
  const amount = await DialogV2.prompt({
    window: { title: "Buy Resource Points" },
    content: `<p>Rate: <strong>${rate} gp per RP</strong>. You can buy up to <strong>${remaining} RP</strong> more this week.</p>
      <div class="form-group"><label>RP to buy</label><input type="number" name="amount" min="1" max="${remaining}" value="${remaining}" autofocus></div>
      <p class="hint">Remove the gold from the party's sheets yourself.</p>`,
    ok: { label: "Buy", callback: (event, button) => Number(button.form.elements.amount.value) }
  });
  if ( !amount ) return;
  const n = Math.clamp(Math.floor(amount), 1, remaining);
  const sys = actor.system;
  const updates = {
    "system.rp": sys.rp + n,
    "system.resourcesBought": { week: sys.week, amount: (sys.resourcesBought.week === sys.week ? sys.resourcesBought.amount : 0) + n }
  };
  logUpdate(actor, `Bought ${n} RP for ${n * rate} gp`, updates);
  await actor.update(updates);
  return chat(actor, `<p>${escape(actor.name)} buys <strong>${n} RP</strong> for <strong>${n * rate} gp</strong>.</p>`);
}

export async function takeLoan(actor) {
  const sys = actor.system;
  if ( sys.loan.amount ) return ui.notifications.warn("You can have only one loan at a time.");
  const amount = await DialogV2.prompt({
    window: { title: "Bank loan" },
    content: `<div class="form-group"><label>Loan (max 50 RP)</label><input type="number" name="amount" min="1" max="50" value="50" autofocus></div>
      <p class="hint">Repay the loan plus 20% within 4 weeks, or gain 1 Unrest each week it's overdue.</p>`,
    ok: { label: "Take loan", callback: (event, button) => Number(button.form.elements.amount.value) }
  });
  if ( !amount ) return;
  const n = Math.clamp(Math.floor(amount), 1, 50);
  const updates = { "system.rp": sys.rp + n, "system.loan": { amount: n, dueWeek: sys.week + 4 } };
  logUpdate(actor, `Took a Bank loan of ${n} RP (repay ${Math.ceil(n * 1.2)} RP by week ${sys.week + 4})`, updates);
  return actor.update(updates);
}

export async function repayLoan(actor) {
  const sys = actor.system;
  const due = Math.ceil(sys.loan.amount * 1.2);
  if ( !sys.loan.amount ) return;
  if ( sys.rp < due ) return ui.notifications.warn(`Repaying needs ${due} RP; the kingdom has ${sys.rp}.`);
  const updates = { "system.rp": sys.rp - due, "system.loan": { amount: 0, dueWeek: null } };
  logUpdate(actor, `Repaid the Bank loan: −${due} RP`, updates);
  return actor.update(updates);
}

/* -------------------------------------------- */
/*  Kingdom actions                             */
/* -------------------------------------------- */

/**
 * Limited-use kingdom actions granted by buildings and feats.
 * `requires` is a building identifier or `feat:<identifier>`.
 */
export const ACTIONS = {
  tradeFair: {
    label: "Host a trade fair", requires: "market-square", frequency: "fourWeeks",
    hint: "Next RP roll: +1d10 per trade agreement",
    async run(actor) {
      const n = actor.system.tradeAgreements.length;
      if ( !n ) return ui.notifications.warn("Your kingdom has no trade agreements, so the fair adds no dice.");
      const updates = useUpdate(actor, "tradeFair", { "system.pendingDice": actor.system.pendingDice + n });
      logUpdate(actor, `Trade fair: next RP roll +${n}d10`, updates);
      return actor.update(updates);
    }
  },
  tournament: {
    label: "Host a tournament", requires: "arena", frequency: "fourWeeks",
    hint: "−1 Unrest, next RP roll +4d10",
    async run(actor) {
      const updates = useUpdate(actor, "tournament", { "system.pendingDice": actor.system.pendingDice + 4 });
      unrestChange(actor, -1, {}, updates);
      logUpdate(actor, "Tournament: −1 Unrest, next RP roll +4d10", updates);
      return actor.update(updates);
    }
  },
  tithes: {
    label: "Collect tithes", requires: "cathedral", frequency: "week",
    hint: "+20 RP, +1 Unrest",
    async run(actor) {
      const updates = useUpdate(actor, "tithes", { "system.rp": actor.system.rp + 20 });
      const { delta } = unrestChange(actor, 1, {}, updates);
      logUpdate(actor, `Collected tithes: +20 RP, +${delta} Unrest`, updates);
      return actor.update(updates);
    }
  },
  blackMarket: {
    label: "Take a cut of the black market", requires: "black-market", frequency: "week",
    hint: "+3d10 RP, +2 Unrest",
    async run(actor) {
      const roll = await new Roll("3d10").evaluate();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Black market cut (RP)" });
      const updates = useUpdate(actor, "blackMarket", { "system.rp": actor.system.rp + roll.total });
      const { delta } = unrestChange(actor, 2, {}, updates);
      logUpdate(actor, `Black market cut: +${roll.total} RP, +${delta} Unrest`, updates);
      return actor.update(updates);
    }
  },
  debase: {
    label: "Debase the coinage", requires: "mint", frequency: "fourWeeks",
    hint: "+40 RP, +2 Unrest",
    async run(actor) {
      const updates = useUpdate(actor, "debase", { "system.rp": actor.system.rp + 40 });
      const { delta } = unrestChange(actor, 2, {}, updates);
      logUpdate(actor, `Debased the coinage: +40 RP, +${delta} Unrest`, updates);
      return actor.update(updates);
    }
  },
  holiday: {
    label: "Declare a holiday", requires: "grand-tavern", frequency: "fourWeeks",
    hint: "This week: no Unrest from any source, projects don't progress",
    async run(actor) {
      const updates = useUpdate(actor, "holiday", { "system.holidayWeek": actor.system.week });
      logUpdate(actor, "Declared a holiday: no Unrest this week, projects don't progress", updates);
      return actor.update(updates);
    }
  },
  festival: {
    label: "Declare a festival", requires: "feat:festival-season", frequency: "fourWeeks",
    hint: "Spend 5 RP per level, −2 Unrest",
    async run(actor) {
      const cost = 5 * actor.system.level;
      if ( actor.system.rp < cost ) return ui.notifications.warn(`A festival costs ${cost} RP.`);
      const updates = useUpdate(actor, "festival", { "system.rp": actor.system.rp - cost });
      unrestChange(actor, -2, {}, updates);
      logUpdate(actor, `Festival: −${cost} RP, −2 Unrest`, updates);
      return actor.update(updates);
    }
  },
  hireAdventurers: {
    label: "Hire adventurers at an Inn", requires: "inn", frequency: "week",
    hint: "Spend 20 RP; the DM decides the outcome",
    async run(actor) {
      if ( actor.system.rp < 20 ) return ui.notifications.warn("Hiring adventurers costs 20 RP.");
      const updates = useUpdate(actor, "hireAdventurers", { "system.rp": actor.system.rp - 20 });
      logUpdate(actor, "Hired adventurers at an Inn: −20 RP", updates);
      await actor.update(updates);
      return chat(actor, `<p>${escape(actor.name)} hires adventurers at an Inn to deal with a minor problem (−20 RP). The DM decides the outcome.</p>`);
    }
  }
};

export function actionAvailable(actor, key) {
  const action = ACTIONS[key];
  const snap = actor.system.snapshot;
  const has = action.requires.startsWith("feat:")
    ? R.hasFeat(snap, action.requires.slice(5))
    : R.hasBuilding(snap, action.requires);
  return {
    has,
    ready: has && available(actor, key, action.frequency),
    wait: R.weeksUntilAvailable(actor.system.usage, key, action.frequency, actor.system.week)
  };
}

export async function runAction(actor, key) {
  const action = ACTIONS[key];
  if ( !action ) return;
  const state = actionAvailable(actor, key);
  if ( !state.has ) return ui.notifications.warn("Your kingdom doesn't have what this action needs.");
  if ( !state.ready ) return ui.notifications.warn(`${action.label} is used; available again in ${state.wait} week(s).`);
  return action.run(actor);
}

/** Stockyard slaughter (per Stockyard, once every 4 weeks). */
export async function slaughter(actor, itemId) {
  const item = actor.items.get(itemId);
  if ( !item ) return;
  const key = `slaughter-${itemId}`;
  if ( !available(actor, key, "fourWeeks") ) return ui.notifications.warn("This Stockyard slaughtered livestock less than 4 weeks ago.");
  await item.update({ "system.special": actor.system.week });
  const updates = useUpdate(actor, key);
  logUpdate(actor, `${item.name}: slaughtered extra livestock (+4 Food this week, none next week)`, updates);
  return actor.update(updates);
}

/* -------------------------------------------- */
/*  Dialogs                                     */
/* -------------------------------------------- */

/**
 * DialogV2.wait with a callback once the dialog's HTML is on screen.
 * Uses the renderDialogV2 hook so it doesn't depend on undocumented dialog options.
 * @param {object} config            DialogV2.wait configuration.
 * @param {Function} onRender        (dialog, rootElement) => void
 */
export async function waitDialog(config, onRender) {
  const marker = foundry.utils.randomID();
  config.content = `<div data-ks-dialog="${marker}">${config.content}</div>`;
  let done = false;
  const hookId = Hooks.on("renderDialogV2", (app, element) => {
    if ( done ) return;
    const root = element instanceof HTMLElement ? element : app.element;
    const inner = root?.querySelector?.(`[data-ks-dialog="${marker}"]`);
    if ( !inner ) return;
    done = true;
    onRender(app, inner.closest("form") ?? root);
  });
  try {
    return await DialogV2.wait(config);
  } finally {
    Hooks.off("renderDialogV2", hookId);
  }
}

/* -------------------------------------------- */
/*  Agreements                                  */
/* -------------------------------------------- */

/**
 * Sign an agreement: the kingdom receives its RP and takes on its debt.
 * @param {Actor} actor
 * @param {object} itemData   Source data of the agreement item.
 */
export async function signAgreement(actor, itemData) {
  const sys = actor.system;
  const a = itemData.system ?? {};
  const name = itemData.name;
  const ok = await DialogV2.confirm({
    window: { title: `Sign: ${name}` },
    content: `<p>Your kingdom receives <strong>${a.loan} RP</strong> now and owes <strong>${a.repayTotal} RP</strong>.</p>
      <p>Until it's repaid, Build Structure projects cost <strong>+${a.surcharge}% RP</strong>. You must repay at least
      ${a.minPayment} RP every ${a.periodWeeks} weeks; each period you don't, the surcharge rises by ${a.surchargeStep}%.</p>`
  });
  if ( !ok ) return null;
  const data = foundry.utils.deepClone(itemData);
  delete data._id;
  Object.assign(data.system, {
    signedWeek: sys.week, debt: a.repayTotal, periodStart: sys.week, paidThisPeriod: 0, missed: 0
  });
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  const updates = { "system.rp": sys.rp + (Number(a.loan) || 0) };
  logUpdate(actor, `Signed ${name}: +${a.loan} RP, owes ${a.repayTotal} RP`, updates);
  await actor.update(updates);
  await chat(actor, `<p><strong>${escape(actor.name)}</strong> signs ${escape(name)}: <strong>+${a.loan} RP</strong>.
    Building costs +${a.surcharge}% until ${a.repayTotal} RP is repaid.</p>`);
  return item;
}

/** Repay part or all of an agreement's debt from the kingdom's RP. */
export async function repayAgreement(actor, itemId) {
  const item = actor.items.get(itemId);
  if ( !item || (item.system.debt <= 0) ) return;
  const sys = actor.system;
  const max = Math.min(item.system.debt, sys.rp);
  if ( max <= 0 ) return ui.notifications.warn("The kingdom has no RP to repay with.");
  const due = Math.min(item.system.minPayment - item.system.paidThisPeriod, item.system.debt);
  const amount = await DialogV2.prompt({
    window: { title: `Repay: ${item.name}` },
    content: `<p>Debt left: <strong>${item.system.debt} RP</strong>. Kingdom RP: ${sys.rp}.</p>
      <p>${due > 0 ? `Still due this period: <strong>${due} RP</strong>.` : "This period's minimum is paid."}</p>
      <div class="form-group"><label>RP to repay</label><input type="number" name="amount" min="1" max="${max}" value="${Math.min(Math.max(due, 1), max)}" autofocus></div>`,
    ok: { label: "Repay", callback: (event, button) => Number(button.form.elements.amount.value) },
    rejectClose: false
  });
  if ( !amount ) return;
  const n = Math.clamp(Math.floor(amount), 1, max);
  const debt = item.system.debt - n;
  await item.update({ "system.debt": debt, "system.paidThisPeriod": item.system.paidThisPeriod + n });
  const updates = { "system.rp": sys.rp - n };
  logUpdate(actor, debt ? `Repaid ${n} RP to ${item.name} (${debt} RP left)` : `Repaid ${n} RP to ${item.name}: debt cleared, surcharge ends`, updates);
  await actor.update(updates);
  if ( !debt ) await chat(actor, `<p>${escape(actor.name)} has repaid ${escape(item.name)} in full. The building surcharge ends.</p>`);
}
