/**
 * Kingdom actor sheet.
 */
import {
  ABILITIES, ADVISORS, ASI_LEVELS, DIFFICULTIES, FREQUENCIES, GOVERNMENTS, MODULE_ID, PROJECT_TYPES,
  SETTLEMENT_SIZES, TYPES
} from "../config.mjs";
import * as R from "../rules.mjs";
import * as K from "../kingdom-api.mjs";
import { kingdomCheckDialog } from "../checks.mjs";
import { cancelProject, completeProject, newProjectDialog, toggleFocus, updateProject } from "../projects.mjs";
import TurnWizard from "./turn-wizard.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const TABS = [
  { id: "overview", label: "Overview", icon: "fa-solid fa-crown" },
  { id: "advisors", label: "Advisors", icon: "fa-solid fa-users" },
  { id: "settlements", label: "Settlements", icon: "fa-solid fa-city" },
  { id: "projects", label: "Projects", icon: "fa-solid fa-hammer" },
  { id: "kingdom", label: "Kingdom", icon: "fa-solid fa-scroll" }
];

const signed = n => `${n >= 0 ? "+" : ""}${n}`;
const tooltip = parts => parts.map(p => `${p.label}: ${signed(p.value)}`).join("<br>");

export default class KingdomSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["kingdom-simplified", "ks-sheet"],
    position: { width: 820, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      ksTab: KingdomSheet.#onTab,
      rollAbility: KingdomSheet.#onRollAbility,
      rollAdvisor: KingdomSheet.#onRollAdvisor,
      quell: KingdomSheet.#onQuell,
      startTurn: KingdomSheet.#onStartTurn,
      levelUp: KingdomSheet.#onLevelUp,
      buyRp: KingdomSheet.#onBuyRp,
      takeLoan: KingdomSheet.#onTakeLoan,
      repayLoan: KingdomSheet.#onRepayLoan,
      kingdomAction: KingdomSheet.#onKingdomAction,
      addSettlement: KingdomSheet.#onAddSettlement,
      deleteSettlement: KingdomSheet.#onDeleteSettlement,
      buildIn: KingdomSheet.#onBuildIn,
      openItem: KingdomSheet.#onOpenItem,
      deleteItem: KingdomSheet.#onDeleteItem,
      togglePerk: KingdomSheet.#onTogglePerk,
      slaughter: KingdomSheet.#onSlaughter,
      newProject: KingdomSheet.#onNewProject,
      focusProject: KingdomSheet.#onFocusProject,
      completeProject: KingdomSheet.#onCompleteProject,
      cancelProject: KingdomSheet.#onCancelProject,
      clearAdvisor: KingdomSheet.#onClearAdvisor,
      addRow: KingdomSheet.#onAddRow,
      deleteRow: KingdomSheet.#onDeleteRow,
      adjust: KingdomSheet.#onAdjust,
      awardRenown: KingdomSheet.#onAwardRenown,
      eventUnrest: KingdomSheet.#onEventUnrest,
      openCompendium: KingdomSheet.#onOpenCompendium,
      repayAgreement: KingdomSheet.#onRepayAgreement
    }
  };

  /** @override */
  static PARTS = {
    header: { template: `modules/${MODULE_ID}/templates/sheet/header.hbs` },
    nav: { template: `modules/${MODULE_ID}/templates/sheet/nav.hbs` },
    overview: { template: `modules/${MODULE_ID}/templates/sheet/overview.hbs`, scrollable: [""] },
    advisors: { template: `modules/${MODULE_ID}/templates/sheet/advisors.hbs`, scrollable: [""] },
    settlements: { template: `modules/${MODULE_ID}/templates/sheet/settlements.hbs`, scrollable: [""] },
    projects: { template: `modules/${MODULE_ID}/templates/sheet/projects.hbs`, scrollable: [""] },
    kingdom: { template: `modules/${MODULE_ID}/templates/sheet/kingdom.hbs`, scrollable: [""] }
  };

  /** Currently shown tab. */
  activeTab = "overview";

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const snap = sys.snapshot;
    const d = sys.derived;
    const isGM = game.user.isGM;
    const week = sys.week;

    // Abilities
    const abilities = Object.entries(d.abilities).map(([key, a]) => ({
      key, label: a.label, total: a.total, mod: signed(a.mod), tooltip: tooltip(a.parts),
      adjustment: sys.abilities[key]?.adjustment ?? 0,
      advisors: Object.entries(ADVISORS).filter(([, v]) => v.ability === key).map(([, v]) => v.label).join(", ")
    }));

    // Advisors
    const deputyOk = R.deputyAvailable(snap);
    const deputyRole = R.deputyRole(snap);
    const vacant = new Set(d.vacant.map(v => v.key));
    const advisors = Object.entries(ADVISORS).map(([key, cfg]) => {
      const a = sys.advisors[key];
      const linked = a.actorUuid ? fromUuidSync(a.actorUuid) : null;
      return {
        key, label: cfg.label, ability: ABILITIES[cfg.ability],
        actorName: linked?.name ?? "", actorImg: linked?.img ?? "", actorUuid: a.actorUuid,
        name: a.name, away: a.away, deputy: a.deputy,
        deputyOk, isDeputy: deputyRole === key, vacant: vacant.has(key)
      };
    });

    // Settlements
    const buildings = actor.items.filter(i => i.type === TYPES.building);
    const settlementIds = new Set(sys.settlements.map(s => s.id));
    const perk = item => {
      const freq = item.system.perk?.frequency ?? "none";
      if ( freq === "none" ) return null;
      const key = `perk-${item.id}`;
      return {
        label: item.system.perk.label || "Use", frequency: FREQUENCIES[freq],
        used: !R.isAvailable(sys.usage, key, freq, week),
        wait: R.weeksUntilAvailable(sys.usage, key, freq, week)
      };
    };
    const settlements = sys.settlements.map(s => {
      const slots = R.settlementSlots(snap, s);
      return {
        ...s,
        sizeOptions: Object.fromEntries(Object.entries(SETTLEMENT_SIZES).map(([k, v]) => [k, v.label])),
        slots, slotsTooltip: tooltip(slots.parts), over: slots.free < 0,
        food: SETTLEMENT_SIZES[s.size]?.food ?? 0,
        buildings: buildings.filter(b => b.system.settlement === s.id).map(b => ({
          id: b.id, name: b.name, img: b.img, slots: b.system.slots, rpDice: b.system.rpDice, food: b.system.food,
          perk: perk(b),
          menagerie: b.system.identifier === "menagerie", counter: b.system.counter,
          orchard: b.system.identifier === "orchard",
          stockyard: (b.system.identifier === "stockyard")
            ? { ready: R.isAvailable(sys.usage, `slaughter-${b.id}`, "fourWeeks", week),
              wait: R.weeksUntilAvailable(sys.usage, `slaughter-${b.id}`, "fourWeeks", week) } : null
        }))
      };
    });
    const unplaced = buildings.filter(b => !settlementIds.has(b.system.settlement)).map(b => ({ id: b.id, name: b.name }));

    // Projects
    const projects = sys.projects.map(p => ({
      ...p,
      typeLabel: PROJECT_TYPES[p.type]?.label ?? p.type,
      settlementName: sys.settlements.find(s => s.id === p.settlement)?.name ?? "",
      pct: p.weeksNeeded ? Math.min(Math.round((p.weeksDone / p.weeksNeeded) * 100), 100) : 0,
      rate: R.projectProgress(snap, p)
    }));

    // Feats
    const feats = actor.items.filter(i => i.type === TYPES.feat).map(f => ({
      id: f.id, name: f.name, img: f.img, prerequisite: f.system.prerequisite,
      assurance: f.system.identifier === "kingdom-assurance", ability: f.system.ability,
      perk: perk(f), tooLow: f.system.prerequisite > sys.level
    }));

    // Actions
    const actions = Object.entries(K.ACTIONS).map(([key, a]) => ({ key, label: a.label, hint: a.hint, ...K.actionAvailable(actor, key) }))
      .filter(a => a.has);

    // ASI levels reached
    const asi = ASI_LEVELS.filter(l => l <= sys.level).map(l => ({ level: l, value: sys.asi[l] }));

    const tier = sys.unrestTier;
    const pending = R.pendingLevels(sys.level, sys.renown);
    const supplies = d.production.total - d.consumption.total;
    const purchase = K.purchaseInfo(actor);
    const featSlots = R.featSlots(sys.level) + (sys.builtTypes.includes("university") ? 1 : 0);

    return Object.assign(context, {
      actor, system: sys, isGM, editable: this.isEditable,
      tabs: TABS.map(t => ({ ...t, active: t.id === this.activeTab })),
      activeTab: this.activeTab,
      abilities, advisors, settlements, unplaced, projects, feats, actions, asi,
      abilityOptions: { "": "—", ...ABILITIES },
      governmentOptions: { "": "—", ...Object.fromEntries(Object.entries(GOVERNMENTS).map(([k, v]) => [k, v.label])) },
      governmentAbilities: GOVERNMENTS[sys.government]?.abilities.map(a => ABILITIES[a]).join(" and ") ?? "",
      unrest: { penalty: tier.penalty, surcharge: Math.round(tier.surcharge * 100) },
      hungerInfo: R.hungerReduction(snap),
      dicePool: { total: d.dicePool.total, tooltip: tooltip(d.dicePool.parts) || "No dice" },
      food: {
        production: d.production.total, consumption: d.consumption.total, supplies: signed(supplies),
        negative: supplies < 0, prodTooltip: tooltip(d.production.parts) || "None", consTooltip: tooltip(d.consumption.parts) || "None"
      },
      renownNeeded: sys.renownNeeded,
      canLevel: pending.gained > 0,
      settlementCount: sys.settlements.length, settlementsAllowed: d.settlementsAllowed,
      projectCount: sys.projects.length, maxProjects: d.maxProjects, maxFocus: d.maxFocus,
      featCount: feats.length, featSlots,
      agreements: actor.items.filter(i => i.type === TYPES.agreement).map(i => {
        const s = i.system;
        const signed = s.signedWeek !== null;
        const due = R.agreementMinimumDue(i);
        return {
          id: i.id, name: i.name, img: i.img, signed, debt: s.debt, total: s.repayTotal, repaid: signed && (s.debt <= 0),
          surcharge: s.surcharge, missed: s.missed, paid: s.paidThisPeriod, minPayment: s.minPayment,
          due, dueWeek: R.agreementPeriodEnd(i), pct: s.repayTotal ? Math.round(((s.repayTotal - s.debt) / s.repayTotal) * 100) : 100
        };
      }),
      agreementSurcharge: R.agreementSurcharge(snap),
      quellReady: (sys.unrest > 0) && K.available(actor, "quell", "week"),
      quellUsed: !K.available(actor, "quell", "week"),
      purchase, hasBank: R.hasBuilding(snap, "bank"),
      loanDue: sys.loan.amount ? Math.ceil(sys.loan.amount * 1.2) : 0,
      loanOverdue: sys.loan.amount && (sys.loan.dueWeek !== null) && (week >= sys.loan.dueWeek),
      holiday: sys.holidayWeek === week,
      log: [...sys.log].reverse().slice(0, 40),
      difficulties: DIFFICULTIES,
      vacantCount: d.vacant.length
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if ( TABS.some(t => t.id === partId) ) context.tab = { id: partId, active: this.activeTab === partId };
    return context;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#showTab(this.activeTab);
    const el = this.element;

    // Array fields edited outside the normal form submission.
    for ( const input of el.querySelectorAll("[data-ks-edit]") ) {
      input.addEventListener("change", event => this.#onEditRow(event));
    }
    for ( const input of el.querySelectorAll("[data-item-edit]") ) {
      input.addEventListener("change", event => this.#onEditItem(event));
    }
  }

  #showTab(id) {
    for ( const nav of this.element.querySelectorAll("[data-action=ksTab]") ) {
      nav.classList.toggle("active", nav.dataset.tab === id);
    }
    for ( const section of this.element.querySelectorAll("section.ks-tab") ) {
      section.classList.toggle("active", section.dataset.tab === id);
    }
  }

  /* -------------------------------------------- */
  /*  Inline editing of arrays                    */
  /* -------------------------------------------- */

  async #onEditRow(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const { ksEdit: field, id, key } = input.dataset;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if ( input.type === "number" ) value = input.value === "" ? null : Number(input.value);
    const actor = this.actor;

    if ( field === "settlements" ) return K.updateSettlement(actor, id, { [key]: value });
    if ( field === "projects" ) return updateProject(actor, id, { [key]: value });
    const rows = actor.system[field].map(r => (r.id === id ? { ...r, [key]: value } : { ...r }));
    return actor.update({ [`system.${field}`]: rows });
  }

  async #onEditItem(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const item = this.actor.items.get(input.dataset.itemId);
    if ( !item ) return;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if ( input.type === "number" ) value = Number(input.value) || 0;
    return item.update({ [input.dataset.itemEdit]: value });
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /** @override */
  async _onDropItem(event, item) {
    if ( !this.isEditable ) return null;
    const actor = this.actor;
    if ( item.parent === actor ) return this.#moveBuilding(event, item);

    if ( item.type === TYPES.feat ) return this.#dropFeat(item);
    if ( item.type === TYPES.agreement ) {
      if ( !game.user.isGM ) {
        ui.notifications.warn("Only the GM can sign agreements for the kingdom.");
        return null;
      }
      return K.signAgreement(actor, item.toObject());
    }
    if ( item.type !== TYPES.building ) {
      ui.notifications.warn("Only kingdom buildings, feats and agreements can be added to a kingdom.");
      return null;
    }
    const zone = event.target.closest("[data-settlement-id]");
    let settlementId = zone?.dataset.settlementId;
    if ( !settlementId ) {
      if ( actor.system.settlements.length === 1 ) settlementId = actor.system.settlements[0].id;
      else {
        ui.notifications.warn("Drop the building onto a settlement on the Settlements tab.");
        return null;
      }
    }
    const settlement = actor.system.settlements.find(s => s.id === settlementId);
    const problems = R.validateBuilding(actor.system.snapshot, { id: null, name: item.name, system: item.system }, settlement);

    if ( !game.user.isGM ) {
      return newProjectDialog(actor, { type: "buildStructure", settlement: settlementId, buildingUuid: item.uuid });
    }

    const choice = await DialogV2.wait({
      window: { title: `${item.name} → ${settlement.name}` },
      content: `${problems.length ? `<ul class="ks-warning">${problems.map(p => `<li>${K.escape(p)}</li>`).join("")}</ul>` : ""}
        <p>How should <strong>${K.escape(item.name)}</strong> be added?</p>`,
      buttons: [
        { action: "project", label: "Start a Build Structure project", icon: "fa-solid fa-hammer", default: true },
        { action: "built", label: "Already built (apply Unrest and Renown)", icon: "fa-solid fa-check" },
        { action: "silent", label: "Already built (no effects)", icon: "fa-solid fa-feather" }
      ],
      rejectClose: false
    });
    if ( !choice ) return null;
    if ( choice === "project" ) return newProjectDialog(actor, { type: "buildStructure", settlement: settlementId, buildingUuid: item.uuid });
    const { item: created } = await K.placeBuilding(actor, item.toObject(), settlementId, { effects: choice === "built" });
    return created;
  }

  /** Moving an owned building between settlements. */
  async #moveBuilding(event, item) {
    if ( item.type !== TYPES.building ) return null;
    const zone = event.target.closest("[data-settlement-id]");
    if ( !zone || (zone.dataset.settlementId === item.system.settlement) ) return null;
    if ( !game.user.isGM ) return null;
    return item.update({ "system.settlement": zone.dataset.settlementId });
  }

  async #dropFeat(item) {
    const actor = this.actor;
    const sys = actor.system;
    const warnings = [];
    if ( item.system.prerequisite > sys.level ) warnings.push(`${item.name} needs kingdom level ${item.system.prerequisite}.`);
    const owned = actor.items.filter(i => (i.type === TYPES.feat) && (i.system.identifier === item.system.identifier));
    if ( owned.length && !item.system.repeatable ) warnings.push(`The kingdom already has ${item.name}.`);
    const count = actor.items.filter(i => i.type === TYPES.feat).length;
    const slots = R.featSlots(sys.level) + (sys.builtTypes.includes("university") ? 1 : 0);
    if ( count >= slots ) warnings.push(`The kingdom has ${count} feat(s) and ${slots} feat slot(s) at level ${sys.level}.`);
    if ( warnings.length ) {
      const ok = await DialogV2.confirm({
        window: { title: `Add ${item.name}?` },
        content: `<ul>${warnings.map(w => `<li>${K.escape(w)}</li>`).join("")}</ul><p>Add it anyway?</p>`
      });
      if ( !ok ) return null;
    }
    const data = item.toObject();
    delete data._id;
    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    await K.addLog(actor, `Gained kingdom feat: ${item.name}`);
    return created;
  }

  /** @override */
  async _onDropActor(event, dropped) {
    if ( !this.isEditable ) return null;
    const slot = event.target.closest("[data-advisor]");
    if ( !slot ) {
      ui.notifications.info("Drop characters onto an advisor role on the Advisors tab.");
      return null;
    }
    if ( dropped.type === TYPES.kingdom ) return null;
    const role = slot.dataset.advisor;
    const sys = this.actor.system;
    // A character can fill only one role.
    const updates = { [`system.advisors.${role}.actorUuid`]: dropped.uuid, [`system.advisors.${role}.name`]: "" };
    for ( const key of Object.keys(ADVISORS) ) {
      if ( (key !== role) && (sys.advisors[key].actorUuid === dropped.uuid) ) updates[`system.advisors.${key}.actorUuid`] = "";
    }
    K.logUpdate(this.actor, `${dropped.name} appointed ${ADVISORS[role].label}`, updates);
    await this.actor.update(updates);
    return this.actor;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.#showTab(this.activeTab);
  }

  static #onRollAbility(event, target) {
    return kingdomCheckDialog(this.actor, { ability: target.dataset.ability });
  }

  static #onRollAdvisor(event, target) {
    const role = target.dataset.advisor;
    return kingdomCheckDialog(this.actor, { ability: ADVISORS[role].ability, advisor: role, petition: true });
  }

  static #onQuell() {
    return kingdomCheckDialog(this.actor, { quell: true });
  }

  static #onStartTurn() {
    if ( !game.user.isGM ) return ui.notifications.warn("Only the GM runs the weekly turn.");
    new TurnWizard(this.actor).render({ force: true });
  }

  static #onLevelUp() {
    return K.levelUp(this.actor);
  }

  static #onBuyRp() {
    return K.buyResources(this.actor);
  }

  static #onTakeLoan() {
    return K.takeLoan(this.actor);
  }

  static #onRepayLoan() {
    return K.repayLoan(this.actor);
  }

  static #onKingdomAction(event, target) {
    return K.runAction(this.actor, target.dataset.key);
  }

  static #onAddSettlement() {
    return K.addSettlement(this.actor);
  }

  static #onDeleteSettlement(event, target) {
    return K.deleteSettlement(this.actor, target.dataset.id);
  }

  static #onBuildIn(event, target) {
    return newProjectDialog(this.actor, { type: "buildStructure", settlement: target.dataset.id });
  }

  static #onOpenItem(event, target) {
    this.actor.items.get(target.dataset.itemId)?.sheet.render({ force: true });
  }

  static async #onDeleteItem(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if ( !item ) return;
    const ok = await DialogV2.confirm({
      window: { title: `Remove ${item.name}` },
      content: `<p>Remove <strong>${K.escape(item.name)}</strong> from the kingdom? Unrest and Renown already gained are not changed.</p>`
    });
    if ( !ok ) return;
    await item.delete();
    return K.addLog(this.actor, `Removed ${item.name}`);
  }

  static async #onTogglePerk(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if ( !item ) return;
    const key = `perk-${item.id}`;
    const freq = item.system.perk.frequency;
    const used = !R.isAvailable(this.actor.system.usage, key, freq, this.actor.system.week);
    if ( used && (this.actor.system.usage[key] !== this.actor.system.week) ) {
      return ui.notifications.warn("Used in an earlier week; it resets on its own.");
    }
    return K.markUsed(this.actor, key, !used);
  }

  static #onSlaughter(event, target) {
    return K.slaughter(this.actor, target.dataset.itemId);
  }

  static #onNewProject() {
    return newProjectDialog(this.actor);
  }

  static #onFocusProject(event, target) {
    return toggleFocus(this.actor, target.dataset.id);
  }

  static async #onCompleteProject(event, target) {
    if ( !game.user.isGM ) return;
    const ok = await DialogV2.confirm({
      window: { title: "Complete project" },
      content: "<p>Mark this project as finished now and apply its results?</p>"
    });
    if ( ok ) return completeProject(this.actor, target.dataset.id);
  }

  static #onCancelProject(event, target) {
    return cancelProject(this.actor, target.dataset.id);
  }

  static #onClearAdvisor(event, target) {
    const role = target.dataset.advisor;
    return this.actor.update({ [`system.advisors.${role}.actorUuid`]: "", [`system.advisors.${role}.name`]: "" });
  }

  static #onAddRow(event, target) {
    const field = target.dataset.field;
    const rows = this.actor.system[field].map(r => ({ ...r }));
    const id = foundry.utils.randomID();
    if ( field === "tradeAgreements" ) rows.push({ id, name: "New agreement", dice: 1 });
    else if ( field === "events" ) rows.push({ id, name: "New event", weeksLeft: null, dice: 0, food: 0, notes: "" });
    return this.actor.update({ [`system.${field}`]: rows });
  }

  static #onDeleteRow(event, target) {
    const { field, id } = target.dataset;
    return this.actor.update({ [`system.${field}`]: this.actor.system[field].filter(r => r.id !== id) });
  }

  /** +/- buttons for RP and Unrest, with a log entry. */
  static async #onAdjust(event, target) {
    const { field } = target.dataset;
    const label = field === "rp" ? "RP" : "Unrest";
    const value = await DialogV2.prompt({
      window: { title: `Change ${label}` },
      content: `<div class="form-group"><label>Change (+/−)</label><input type="number" name="delta" value="0" autofocus></div>
        <div class="form-group"><label>Reason</label><input type="text" name="reason" placeholder="e.g. Event: bandit raid"></div>
        ${field === "unrest" ? `<div class="form-group"><label>From a kingdom event</label><input type="checkbox" name="event"><p class="hint">Festival Hall reduces the first event Unrest each week by 1.</p></div>` : ""}`,
      ok: {
        label: "Apply",
        callback: (ev, button) => ({
          delta: Number(button.form.elements.delta.value) || 0,
          reason: button.form.elements.reason.value || "Manual change",
          event: !!button.form.elements.event?.checked
        })
      },
      rejectClose: false
    });
    if ( !value?.delta ) return;
    if ( field === "rp" ) return K.changeRp(this.actor, value.delta, value.reason);
    return K.changeUnrest(this.actor, value.delta, value.reason, { fromEvent: value.event });
  }

  static async #onAwardRenown() {
    const value = await DialogV2.prompt({
      window: { title: "Award Renown" },
      content: `<div class="form-group"><label>Renown</label><input type="number" name="amount" value="1" min="1" autofocus></div>
        <div class="form-group"><label>Reason</label><input type="text" name="reason" placeholder="e.g. Defeated the Stag Lord"></div>
        <div class="form-group"><label>Major event, crisis or story milestone</label><input type="checkbox" name="milestone" checked>
        <p class="hint">Famed Realm adds 1 for these.</p></div>`,
      ok: {
        label: "Award",
        callback: (ev, button) => ({
          amount: Number(button.form.elements.amount.value) || 0,
          reason: button.form.elements.reason.value || "Renown awarded",
          milestone: button.form.elements.milestone.checked
        })
      },
      rejectClose: false
    });
    if ( !value?.amount ) return;
    const { amount } = await K.gainRenown(this.actor, value.amount, value.reason, { milestone: value.milestone });
    return K.chat(this.actor, `<p>${K.escape(this.actor.name)} gains <strong>${amount} Renown</strong>: ${K.escape(value.reason)}.</p>`);
  }

  static async #onEventUnrest(event, target) {
    const row = this.actor.system.events.find(e => e.id === target.dataset.id);
    const value = await DialogV2.prompt({
      window: { title: `Unrest from ${row?.name ?? "event"}` },
      content: `<div class="form-group"><label>Unrest gained</label><input type="number" name="amount" value="1" min="1" autofocus></div>`,
      ok: { label: "Apply", callback: (ev, button) => Number(button.form.elements.amount.value) || 0 },
      rejectClose: false
    });
    if ( !value ) return;
    return K.changeUnrest(this.actor, value, `Event: ${row?.name ?? "event"}`, { fromEvent: true });
  }

  static #onOpenCompendium(event, target) {
    game.packs.get(`${MODULE_ID}.${target.dataset.pack}`)?.render(true);
  }

  static #onRepayAgreement(event, target) {
    return K.repayAgreement(this.actor, target.dataset.itemId);
  }
}
