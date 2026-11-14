/**
 * The weekly turn wizard. GM only.
 */
import { HUNGER, MODULE_ID } from "../config.mjs";
import * as R from "../rules.mjs";
import {
  available, chat, escape, logUpdate, notifyLevelUp, slaughter, unrestChange
} from "../kingdom-api.mjs";
import { kingdomCheckDialog } from "../checks.mjs";
import { completeProject } from "../projects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STEPS = [
  { id: "petition", label: "1. Petition Day" },
  { id: "quell", label: "2. Quell Unrest" },
  { id: "rp", label: "3. Resource Points" },
  { id: "projects", label: "4. Projects" },
  { id: "armies", label: "5. Armies" },
  { id: "food", label: "6. Food" },
  { id: "end", label: "End of the week" }
];

const signed = n => `${n >= 0 ? "+" : ""}${n}`;

export default class TurnWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options={}) {
    super(options);
    this.actor = actor;
    this.turn = {
      step: 0,
      attended: null,
      rp: null,          // { dice, results, ones, rerolled, total }
      bookkeepersUsed: false,
      extraDice: 0,
      granary: false,
      summary: []
    };
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "ks-turn-wizard-{id}",
    classes: ["kingdom-simplified", "ks-turn-wizard"],
    tag: "div",
    window: { title: "Weekly turn", icon: "fa-solid fa-hourglass-half", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      attend: TurnWizard.#onAttend,
      quell: TurnWizard.#onQuell,
      rollRp: TurnWizard.#onRollRp,
      bookkeepers: TurnWizard.#onBookkeepers,
      slaughter: TurnWizard.#onSlaughter,
      next: TurnWizard.#onNext
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/apps/turn-wizard.hbs` }
  };

  /** @override */
  get title() {
    return `${this.actor.name} — week ${this.actor.system.week}`;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const step = STEPS[this.turn.step];
    return {
      steps: STEPS.map((s, i) => ({ ...s, active: i === this.turn.step, done: i < this.turn.step })),
      body: await this.#renderStep(step.id),
      nextLabel: step.id === "end" ? "Finish the week" : "Apply and continue"
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // Keep focus inputs and extra dice in state
    for ( const input of this.element.querySelectorAll("input[data-focus]") ) {
      input.addEventListener("change", () => {
        const max = R.maxFocus(this.actor.system.snapshot);
        const checked = [...this.element.querySelectorAll("input[data-focus]:checked")];
        if ( checked.length > max ) {
          input.checked = false;
          ui.notifications.warn(`Only ${max} focus project(s) per week.`);
        }
      });
    }
    const extra = this.element.querySelector("input[name=extraDice]");
    extra?.addEventListener("change", () => {
      this.turn.extraDice = Number(extra.value) || 0;
      this.render();
    });
    const granary = this.element.querySelector("input[name=granary]");
    granary?.addEventListener("change", () => {
      this.turn.granary = granary.checked;
      this.render();
    });
  }

  /* -------------------------------------------- */
  /*  Step bodies                                 */
  /* -------------------------------------------- */

  async #renderStep(id) {
    const actor = this.actor;
    const sys = actor.system;
    const snap = sys.snapshot;
    const d = sys.derived;
    const holiday = sys.holidayWeek === sys.week;
    const list = parts => `<ul class="ks-breakdown">${parts.map(p => `<li><span>${escape(p.label)}</span><span>${signed(p.value)}</span></li>`).join("")}</ul>`;

    switch ( id ) {
      case "petition": {
        const streak = sys.missedPetitions + 1;
        const cost = R.missedPetitionUnrest(streak, R.hasFeat(snap, "open-door"));
        return `
          <p>Did the party attend petition day this week?</p>
          <div class="ks-choice">
            <button type="button" data-action="attend" data-value="yes" class="${this.turn.attended === true ? "active" : ""}"><i class="fa-solid fa-check"></i> Attended</button>
            <button type="button" data-action="attend" data-value="no" class="${this.turn.attended === false ? "active" : ""}"><i class="fa-solid fa-xmark"></i> Absent</button>
          </div>
          <p class="hint">Petitions are roleplayed during the week. Advisors you assign roll from the Advisors tab whenever it suits you.</p>
          ${this.turn.attended === false ? `<p>Missed petition days in a row: <strong>${streak}</strong>. The kingdom gains <strong>${cost} Unrest</strong>${holiday ? " (holiday: ignored)" : ""}.</p>` : ""}
          ${holiday ? `<p class="ks-notice">Holiday this week: no Unrest from any source, projects don't progress.</p>` : ""}`;
      }

      case "quell": {
        if ( !this.turn.attended ) return `<p>The party missed petition day, so Quell Unrest isn't available this week.</p>`;
        if ( sys.unrest <= 0 ) return `<p>The kingdom has no Unrest.</p>`;
        const used = !available(actor, "quell", "week");
        return `<p>Unrest: <strong>${sys.unrest}</strong> (checks −${sys.unrestTier.penalty}).</p>
          ${used ? `<p class="ks-notice">Quell Unrest has been used this week.</p>`
            : `<button type="button" data-action="quell"><i class="fa-solid fa-dove"></i> Roll Quell Unrest</button>`}
          <p class="hint">You can skip this step.</p>`;
      }

      case "rp": {
        const pool = d.dicePool;
        const dice = Math.max(pool.total + this.turn.extraDice, 0);
        const red = R.hungerReduction(snap);
        const r = this.turn.rp;
        let result = "";
        if ( r ) {
          const reduced = R.applyHungerToRoll(r.total, red);
          const net = reduced + d.flatIncome.total - sys.army.upkeep;
          result = `
            <div class="ks-result">
              <p>Rolled ${r.dice}d10: ${r.results.map(x => x === 1 ? `<span class="ks-one">1</span>` : x).join(", ")}
              ${r.rerolled.length ? `<br>Guildhall rerolled ${r.rerolled.length} × 1 → ${r.rerolled.join(", ")}` : ""}</p>
              <ul class="ks-breakdown">
                <li><span>Roll</span><span>${r.total}</span></li>
                ${red ? `<li><span>Hunger ${sys.hunger} (−${red * 100}%, rounded down)</span><span>${reduced - r.total}</span></li>` : ""}
                ${d.flatIncome.parts.map(p => `<li><span>${escape(p.label)}</span><span>+${p.value}</span></li>`).join("")}
                ${sys.army.upkeep ? `<li><span>Upkeep</span><span>−${sys.army.upkeep}</span></li>` : ""}
                <li class="total"><span>RP this week</span><span>${signed(net)}</span></li>
              </ul>
              <p>Kingdom RP after: <strong>${Math.max(sys.rp + net, 0)}</strong></p>
              ${R.hasFeat(snap, "shrewd-bookkeepers") && available(actor, "shrewd-bookkeepers", "week") && !this.turn.bookkeepersUsed
                ? `<button type="button" data-action="bookkeepers"><i class="fa-solid fa-rotate"></i> Shrewd Bookkeepers: reroll everything</button>` : ""}
            </div>`;
        }
        return `
          <p>Dice pool: <strong>${dice}d10</strong></p>
          ${list(pool.parts)}
          <div class="form-group">
            <label>Extra dice from the DM (+/−)</label>
            <input type="number" name="extraDice" value="${this.turn.extraDice}" step="1" ${r ? "disabled" : ""}>
          </div>
          ${R.guildhallRerolls(snap) ? `<p class="hint">Guildhall: up to ${R.guildhallRerolls(snap)} dice that roll 1 are rerolled automatically.</p>` : ""}
          ${red ? `<p class="hint">Hunger ${sys.hunger}: the roll is reduced by ${red * 100}%.</p>` : ""}
          ${r ? result : `<button type="button" data-action="rollRp"><i class="fa-solid fa-dice"></i> Roll ${dice}d10</button>`}`;
      }

      case "projects": {
        if ( !sys.projects.length ) return `<p>No active projects.</p>`;
        const stall = R.projectStallChance(snap);
        const max = R.maxFocus(snap);
        const rows = sys.projects.map(p => {
          const rate = holiday ? 0 : R.projectProgress(snap, { ...p, focus: true }) / 2;
          return `<tr>
            <td><input type="checkbox" data-focus="${p.id}" ${p.focus ? "checked" : ""}></td>
            <td>${escape(p.name)}</td>
            <td>${p.weeksDone}${p.weeksNeeded !== null ? ` / ${p.weeksNeeded}` : ""}</td>
            <td>${p.weeksNeeded === null ? `<label><input type="checkbox" data-complete="${p.id}"> done</label>` : `+${rate}/+${rate * 2}`}</td>
          </tr>`;
        }).join("");
        return `
          ${holiday ? `<p class="ks-notice">Holiday: projects don't progress this week.</p>` : ""}
          ${stall && !holiday ? `<p class="ks-notice">Hunger ${sys.hunger}: each project has a ${stall * 100}% chance not to progress this week (rolled per project when you continue).</p>` : ""}
          <p>Tick up to <strong>${max}</strong> focus project(s). Focus projects progress at twice the normal rate.</p>
          <table class="ks-table"><thead><tr><th>Focus</th><th>Project</th><th>Weeks</th><th>Progress</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="hint">For projects whose length the DM decides, tick "done" when they finish.</p>`;
      }

      case "armies":
        return `<p>Each of your armies can take one army action.</p>
          <p class="hint">Armies are handled by the separate army module. Nothing to do here yet.</p>`;

      case "food": {
        const prod = d.production;
        const cons = d.consumption;
        let supplies = prod.total - cons.total;
        const granaryOk = R.hasBuilding(snap, "granary") && available(actor, "granary", "fourWeeks");
        const useGranary = this.turn.granary && (supplies < 0);
        if ( useGranary ) supplies = 0;
        const hunger = R.hungerAfter(sys.hunger, supplies);
        const stockyards = actor.items.filter(i => (i.system.identifier === "stockyard") && i.system.settlement)
          .filter(i => available(actor, `slaughter-${i.id}`, "fourWeeks") && (i.system.special !== sys.week));
        return `
          <div class="ks-columns">
            <div><h4>Production ${prod.total}</h4>${list(prod.parts)}</div>
            <div><h4>Consumption ${cons.total}</h4>${list(cons.parts)}</div>
          </div>
          ${stockyards.map(s => `<button type="button" data-action="slaughter" data-item="${s.id}"><i class="fa-solid fa-drumstick-bite"></i> ${escape(s.name)}: slaughter extra livestock (+4 Food now, none next week)</button>`).join("")}
          ${(prod.total - cons.total < 0) && granaryOk ? `<div class="form-group"><label>Open the Granary (supplies count as 0)</label><input type="checkbox" name="granary" ${this.turn.granary ? "checked" : ""}></div>` : ""}
          <p>Food supplies: <strong>${signed(supplies)}</strong>. Hunger ${sys.hunger} → <strong>${hunger}</strong>.</p>
          ${hunger ? `<p>Hunger ${hunger}: <strong>+${HUNGER[hunger].unrest} Unrest</strong>${holiday ? " (holiday: ignored)" : ""}, next RP roll −${HUNGER[hunger].rpReduction * 100}%${HUNGER[hunger].stallChance ? `, each project has a ${HUNGER[hunger].stallChance * 100}% chance not to progress` : ""}.</p>` : ""}`;
      }

      case "end": {
        const items = [];
        if ( R.hasFeat(snap, "royal-treasury") && (sys.rp >= 100) ) items.push("Royal Treasury: +1d10 RP interest");
        if ( sys.loan.amount && (sys.loan.dueWeek !== null) && (sys.week >= sys.loan.dueWeek) ) items.push("Bank loan overdue: +1 Unrest");
        for ( const a of R.activeAgreements(snap) ) {
          const r = R.agreementWeekEnd(a, sys.week);
          if ( !r ) continue;
          items.push(r.missed
            ? `<strong>${escape(a.name)}: minimum payment not made (${a.system.paidThisPeriod}/${a.system.minPayment} RP) — building surcharge rises to ${r.surcharge}%</strong>. Repay on the Kingdom tab before finishing to avoid this.`
            : `${escape(a.name)}: this period's payment is made`);
        }
        for ( const e of sys.events ) {
          if ( e.weeksLeft === null ) continue;
          items.push(e.weeksLeft <= 1 ? `Event ends: ${escape(e.name)}` : `${escape(e.name)}: ${e.weeksLeft - 1} week(s) left`);
        }
        items.push(`Weekly uses reset; week ${sys.week + 1} begins`);
        return `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>
          ${this.turn.summary.length ? `<h4>This turn</h4><ul class="ks-summary">${this.turn.summary.map(s => `<li>${escape(s)}</li>`).join("")}</ul>` : ""}`;
      }
    }
    return "";
  }

  /* -------------------------------------------- */
  /*  Applying steps                              */
  /* -------------------------------------------- */

  async #apply(id) {
    const actor = this.actor;
    const sys = actor.system;
    const snap = sys.snapshot;
    const updates = {};
    const say = text => {
      this.turn.summary.push(text);
      logUpdate(actor, text, updates);
    };

    switch ( id ) {
      case "petition": {
        if ( this.turn.attended === null ) {
          ui.notifications.warn("Choose whether the party attended petition day.");
          return false;
        }
        if ( this.turn.attended ) {
          updates["system.missedPetitions"] = 0;
          say("Party attended petition day");
        } else {
          const streak = sys.missedPetitions + 1;
          const cost = R.missedPetitionUnrest(streak, R.hasFeat(snap, "open-door"));
          updates["system.missedPetitions"] = streak;
          const { delta, notes } = unrestChange(actor, cost, {}, updates);
          say(`Missed petition day (${streak} in a row): +${delta} Unrest${notes.length ? ` (${notes.join("; ")})` : ""}`);
        }
        break;
      }

      case "rp": {
        const r = this.turn.rp;
        if ( !r ) {
          ui.notifications.warn("Roll the Resource Points first.");
          return false;
        }
        const d = sys.derived;
        const reduced = R.applyHungerToRoll(r.total, R.hungerReduction(snap));
        const net = reduced + d.flatIncome.total - sys.army.upkeep;
        updates["system.rp"] = Math.max(sys.rp + net, 0);
        updates["system.pendingDice"] = 0;
        say(`Resource Points: rolled ${r.total} on ${r.dice}d10${reduced !== r.total ? `, ${reduced} after Hunger` : ""}${d.flatIncome.total ? `, +${d.flatIncome.total} Menagerie` : ""}${sys.army.upkeep ? `, −${sys.army.upkeep} upkeep` : ""} → ${signed(net)} RP`);
        break;
      }

      case "projects": {
        const holiday = sys.holidayWeek === sys.week;
        const focusIds = new Set([...this.element.querySelectorAll("input[data-focus]:checked")].map(i => i.dataset.focus));
        const doneIds = new Set([...this.element.querySelectorAll("input[data-complete]:checked")].map(i => i.dataset.complete));
        const projects = sys.projects.map(p => ({ ...p, focus: focusIds.has(p.id) }));
        const toComplete = [];
        const stall = holiday ? 0 : R.projectStallChance(snap);
        const stallRolls = [];
        for ( const p of projects ) {
          let gain = holiday ? 0 : R.projectProgress(snap, p);
          if ( gain && stall ) {
            // 1d100: stalls on a roll at or below the chance (50% at Hunger 3).
            const roll = await new Roll("1d100").evaluate();
            const stalled = roll.total <= stall * 100;
            stallRolls.push(roll);
            if ( stalled ) {
              gain = 0;
              say(`${p.name}: stalled by Hunger (rolled ${roll.total})`);
            }
          }
          p.weeksDone += gain;
          if ( gain ) say(`${p.name}: +${gain} week(s) of progress${p.weeksNeeded !== null ? ` (${Math.min(p.weeksDone, p.weeksNeeded)}/${p.weeksNeeded})` : ""}`);
          if ( ((p.weeksNeeded !== null) && (p.weeksDone >= p.weeksNeeded)) || doneIds.has(p.id) ) toComplete.push(p.id);
        }
        updates["system.projects"] = projects;
        if ( holiday ) say("Holiday: projects didn't progress");
        if ( stallRolls.length ) {
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Hunger ${sys.hunger}: stall rolls for projects (${stall * 100} or lower = no progress)`,
            rolls: stallRolls
          });
        }
        for ( const id of toComplete ) {
          const lines = await completeProject(actor, id, updates);
          this.turn.summary.push(...lines);
        }
        break;
      }

      case "armies":
        Hooks.callAll(`${MODULE_ID}.armiesStep`, actor, this);
        break;

      case "food": {
        const d = sys.derived;
        let supplies = d.production.total - d.consumption.total;
        if ( this.turn.granary && (supplies < 0) ) {
          supplies = 0;
          updates["system.usage.granary"] = sys.week;
          say("Opened the Granary: Food supplies count as 0");
        }
        const hunger = R.hungerAfter(sys.hunger, supplies);
        updates["system.hunger"] = hunger;
        say(`Food: ${d.production.total} produced, ${d.consumption.total} consumed (${signed(supplies)}). Hunger ${sys.hunger} → ${hunger}`);
        if ( hunger ) {
          const { delta, notes } = unrestChange(actor, HUNGER[hunger].unrest, {}, updates);
          say(`Hunger ${hunger}: +${delta} Unrest${notes.length ? ` (${notes.join("; ")})` : ""}`);
        }
        break;
      }

      case "end": {
        if ( R.hasFeat(snap, "royal-treasury") && (sys.rp >= 100) ) {
          const roll = await new Roll("1d10").evaluate();
          await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Royal Treasury interest (RP)" });
          updates["system.rp"] = sys.rp + roll.total;
          say(`Royal Treasury: +${roll.total} RP`);
        }
        if ( sys.loan.amount && (sys.loan.dueWeek !== null) && (sys.week >= sys.loan.dueWeek) ) {
          const { delta } = unrestChange(actor, 1, {}, updates);
          say(`Bank loan overdue: +${delta} Unrest`);
        }
        for ( const a of R.activeAgreements(snap) ) {
          const r = R.agreementWeekEnd(a, sys.week);
          if ( !r ) continue;
          const item = actor.items.get(a.id);
          const change = { "system.periodStart": r.periodStart, "system.paidThisPeriod": 0 };
          if ( r.missed ) {
            change["system.surcharge"] = r.surcharge;
            change["system.missed"] = a.system.missed + 1;
            say(`${a.name}: minimum payment missed, building surcharge rises to ${r.surcharge}%`);
          } else say(`${a.name}: payment period closed, minimum paid`);
          await item?.update(change);
        }
        const events = [];
        for ( const e of sys.events ) {
          if ( e.weeksLeft === null ) events.push({ ...e });
          else if ( e.weeksLeft > 1 ) events.push({ ...e, weeksLeft: e.weeksLeft - 1 });
          else say(`Event ended: ${e.name}`);
        }
        updates["system.events"] = events;
        updates["system.week"] = sys.week + 1;
        logUpdate(actor, `Week ${sys.week} ends`, updates);
        await actor.update(updates);
        notifyLevelUp(actor);
        await chat(actor, `<h3>${escape(actor.name)}: week ${sys.week}</h3>
          <ul>${this.turn.summary.map(s => `<li>${escape(s)}</li>`).join("")}</ul>
          <p>RP ${actor.system.rp} · Unrest ${actor.system.unrest} · Hunger ${actor.system.hunger} · Renown ${actor.system.renown}</p>`);
        return "close";
      }
    }
    if ( !foundry.utils.isEmpty(updates) ) await actor.update(updates);
    return true;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onAttend(event, target) {
    this.turn.attended = target.dataset.value === "yes";
    this.render();
  }


  static async #onQuell() {
    await kingdomCheckDialog(this.actor, { quell: true });
    this.render();
  }

  /** Roll the RP dice, with Guildhall rerolls of 1s. */
  async #rollRp(source) {
    const actor = this.actor;
    const snap = actor.system.snapshot;
    const dice = Math.max(actor.system.derived.dicePool.total + this.turn.extraDice, 0);
    if ( !dice ) {
      this.turn.rp = { dice: 0, results: [], rerolled: [], total: 0 };
      return this.render();
    }
    const roll = await new Roll(`${dice}d10`).evaluate();
    const results = roll.dice[0].results.map(r => r.result);
    const ones = results.filter(r => r === 1).length;
    const n = Math.min(ones, R.guildhallRerolls(snap));
    const rolls = [roll];
    let rerolled = [];
    let total = roll.total;
    if ( n ) {
      const re = await new Roll(`${n}d10`).evaluate();
      rerolled = re.dice[0].results.map(r => r.result);
      total = total - n + re.total;
      rolls.push(re);
    }
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `Weekly Resource Points${source ? ` (${source})` : ""}${n ? ` — Guildhall rerolled ${n} × 1` : ""}: ${total}`,
      rolls
    });
    this.turn.rp = { dice, results, rerolled, total };
    this.render();
  }

  static async #onRollRp() {
    await this.#rollRp();
  }

  static async #onBookkeepers() {
    await this.actor.update({ "system.usage.shrewd-bookkeepers": this.actor.system.week });
    this.turn.bookkeepersUsed = true;
    this.turn.summary.push("Shrewd Bookkeepers: rerolled the Resource Points");
    await this.#rollRp("Shrewd Bookkeepers reroll");
  }

  static async #onSlaughter(event, target) {
    await slaughter(this.actor, target.dataset.item);
    this.turn.summary.push("Stockyard slaughter: +4 Food this week");
    this.render();
  }

  static async #onNext() {
    const step = STEPS[this.turn.step];
    const result = await this.#apply(step.id);
    if ( result === false ) return;
    if ( result === "close" ) return this.close();
    this.turn.step += 1;
    this.render();
  }
}
