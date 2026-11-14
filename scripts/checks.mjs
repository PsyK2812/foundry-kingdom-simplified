/**
 * Kingdom checks: roll dialog, Quell Unrest, chat cards and reroll buttons.
 */
import { ABILITIES, ADVISORS, DIFFICULTIES, MODULE_ID } from "./config.mjs";
import * as R from "./rules.mjs";
import { available, escape, logUpdate, unrestChange } from "./kingdom-api.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Open the check dialog and roll.
 * @param {Actor} actor
 * @param {object} [preset]
 * @param {string} [preset.ability]
 * @param {boolean} [preset.quell]     Quell Unrest check.
 * @param {string} [preset.advisor]    Advisor role key.
 * @param {boolean} [preset.petition]  Check made to solve a petition.
 * @param {string} [preset.label]
 * @returns {Promise<ChatMessage|null>}
 */
export async function kingdomCheckDialog(actor, preset={}) {
  const sys = actor.system;
  const snap = sys.snapshot;
  const quell = !!preset.quell;
  const abilities = sys.derived.abilities;

  if ( quell ) {
    if ( sys.unrest <= 0 ) {
      ui.notifications.info("Your kingdom has no Unrest to quell.");
      return null;
    }
    if ( !available(actor, "quell", "week") ) {
      ui.notifications.warn("Quell Unrest has already been used this week.");
      return null;
    }
  }

  const abilityOptions = quell
    ? (R.hasFeat(snap, "inspiring-entertainment") ? ["loyalty", "culture"] : ["loyalty"])
    : Object.keys(ABILITIES);
  const ability = preset.ability && abilityOptions.includes(preset.ability) ? preset.ability : abilityOptions[0];

  const assuranceFeats = snap.feats.filter(f => (f.system.identifier === "kingdom-assurance") && f.system.ability
    && available(actor, `assurance-${f.id}`, "week"));
  const brewery = quell && R.hasBuilding(snap, "brewery") && available(actor, "brewery", "week");
  const breweryCost = 5 + (5 * sys.level);
  const bathhouse = R.hasBuilding(snap, "bathhouse") && available(actor, "bathhouse", "week");
  const deputy = R.deputyRole(snap);

  const opt = (value, label, selected) => `<option value="${value}" ${selected ? "selected" : ""}>${escape(label)}</option>`;
  const content = `
    <div class="ks-check-dialog">
      <div class="form-group">
        <label>Ability</label>
        <select name="ability">${abilityOptions.map(k => opt(k, `${ABILITIES[k]} (${abilities[k].mod >= 0 ? "+" : ""}${abilities[k].mod})`, k === ability)).join("")}</select>
      </div>
      <div class="form-group">
        <label>Difficulty</label>
        <select name="difficulty">${Object.entries(DIFFICULTIES).map(([k, d]) => opt(k, `${d.label} — DC ${sys.dc + d.mod}`, k === (preset.difficulty ?? "normal"))).join("")}</select>
      </div>
      ${quell ? "" : `
      <div class="form-group">
        <label>Rolled by advisor</label>
        <select name="advisor">${opt("", "— (the party)", !preset.advisor)}${Object.entries(ADVISORS).map(([k, a]) => {
          const who = sys.advisors[k]?.name || (sys.advisors[k]?.actorUuid ? fromUuidSync(sys.advisors[k].actorUuid)?.name : "") || (deputy === k ? "Deputy" : "vacant");
          return opt(k, `${a.label} (${ABILITIES[a.ability]}) — ${who}`, preset.advisor === k);
        }).join("")}</select>
      </div>
      <div class="form-group">
        <label>Solving a petition</label>
        <input type="checkbox" name="petition" ${preset.petition ? "checked" : ""}>
      </div>`}
      <div class="form-group">
        <label>Roll</label>
        <select name="mode">${opt("normal", "Normal", true)}${opt("advantage", "Advantage")}${opt("disadvantage", "Disadvantage")}</select>
      </div>
      <div class="form-group">
        <label>Situational bonus</label>
        <input type="number" name="bonus" value="0" step="1" style="flex:0 0 4em">
        <input type="text" name="bonusLabel" placeholder="Source, e.g. Keep" style="flex:1">
      </div>
      ${assuranceFeats.length ? `<div class="form-group"><label>Kingdom Assurance (${assuranceFeats.map(f => ABILITIES[f.system.ability]).join(", ")})</label>
        <input type="checkbox" name="assurance"><p class="hint">Treat a d20 roll of 9 or lower as 10. Uses it for this week.</p></div>` : ""}
      ${brewery ? `<div class="form-group"><label>Brewery: free drinks (${breweryCost} RP, advantage)</label><input type="checkbox" name="brewery"></div>` : ""}
      ${bathhouse ? `<div class="form-group"><label>Bathhouse: advantage on a Loyalty check</label><input type="checkbox" name="bathhouse"><p class="hint">Once per week, Loyalty checks only.</p></div>` : ""}
      ${quell ? `<p class="hint">The Unrest penalty doesn't apply to Quell Unrest.</p>` : ""}
    </div>`;

  const result = await DialogV2.wait({
    window: { title: quell ? "Quell Unrest" : (preset.label ?? "Kingdom check") },
    position: { width: 460 },
    content,
    buttons: [{
      action: "roll", label: "Roll", default: true, icon: "fa-solid fa-dice-d20",
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          ability: f.ability.value,
          difficulty: f.difficulty.value,
          advisor: f.advisor?.value || "",
          petition: !!f.petition?.checked,
          mode: f.mode.value,
          bonus: Number(f.bonus.value) || 0,
          bonusLabel: f.bonusLabel.value,
          assurance: !!f.assurance?.checked,
          brewery: !!f.brewery?.checked,
          bathhouse: !!f.bathhouse?.checked
        };
      }
    }, { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  if ( !result || (result === "cancel") ) return null;
  return rollKingdomCheck(actor, { ...result, quell, label: preset.label });
}

/**
 * Roll a kingdom check without a dialog.
 */
export async function rollKingdomCheck(actor, options) {
  const sys = actor.system;
  const snap = sys.snapshot;
  const { ability, quell } = options;
  const abilities = sys.derived.abilities;
  const score = abilities[ability];
  const dc = sys.dc + (DIFFICULTIES[options.difficulty]?.mod ?? 0);
  const updates = {};
  const notes = [];

  // Advantage sources
  let adv = options.mode === "advantage";
  let dis = options.mode === "disadvantage";
  if ( options.brewery ) {
    const cost = 5 + (5 * sys.level);
    if ( sys.rp < cost ) {
      ui.notifications.warn(`Free drinks cost ${cost} RP; the kingdom has ${sys.rp}.`);
      return null;
    }
    adv = true;
    updates["system.rp"] = sys.rp - cost;
    updates["system.usage.brewery"] = sys.week;
    notes.push(`Brewery free drinks (−${cost} RP)`);
  }
  if ( options.bathhouse && (ability === "loyalty") ) {
    adv = true;
    updates["system.usage.bathhouse"] = sys.week;
    notes.push("Bathhouse advantage");
  }
  if ( options.advisor && (R.deputyRole(snap) === options.advisor) ) {
    dis = true;
    notes.push("Deputy (disadvantage)");
  }
  if ( options.petition && (options.advisor === "ruler") && R.hasBuilding(snap, "palace", { inCapital: true }) ) {
    adv = true;
    notes.push("Palace (Ruler advantage on petition day)");
  }
  if ( adv && dis ) adv = dis = false;

  // Kingdom Assurance
  let assurance = "";
  if ( options.assurance ) {
    const feat = snap.feats.find(f => (f.system.identifier === "kingdom-assurance") && (f.system.ability === ability)
      && available(actor, `assurance-${f.id}`, "week"));
    if ( feat ) {
      assurance = "min10";
      updates[`system.usage.assurance-${feat.id}`] = sys.week;
      notes.push("Kingdom Assurance");
    }
  }

  const die = adv ? "2d20kh" : (dis ? "2d20kl" : "1d20");
  const terms = [`${die}${assurance}`, "+ @mod", "+ @prof"];
  const data = { mod: score.mod, prof: sys.prof };
  const parts = [`${score.label} ${score.mod >= 0 ? "+" : ""}${score.mod}`, `Proficiency +${sys.prof}`];
  if ( !quell && sys.unrestTier.penalty ) {
    terms.push("- @unrest");
    data.unrest = sys.unrestTier.penalty;
    parts.push(`Unrest −${sys.unrestTier.penalty}`);
  }
  for ( const b of R.checkBonuses(snap, ability) ) {
    const key = `b${terms.length}`;
    terms.push(`+ @${key}`);
    data[key] = b.value;
    parts.push(`${b.label} +${b.value}`);
  }
  if ( quell && R.hasBuilding(snap, "arena") ) {
    terms.push("+ @arena");
    data.arena = 1;
    parts.push("Arena +1");
  }
  if ( options.bonus ) {
    terms.push("+ @situational");
    data.situational = options.bonus;
    parts.push(`${options.bonusLabel || "Situational"} ${options.bonus >= 0 ? "+" : ""}${options.bonus}`);
  }

  const formula = terms.join(" ");
  const roll = await new Roll(formula, data).evaluate();
  return postCheck(actor, roll, {
    ability, dc, quell, advisor: options.advisor, petition: options.petition,
    label: options.label, parts, notes, updates, formula, data
  });
}

/** The kept d20 result. */
function naturalD20(roll) {
  const die = roll.dice[0];
  const kept = die.results.find(r => r.active && !r.discarded) ?? die.results[0];
  return kept?.result ?? 0;
}

/**
 * Create the chat card for a check and apply Quell Unrest results.
 */
async function postCheck(actor, roll, ctx) {
  const sys = actor.system;
  const snap = sys.snapshot;
  const nat = naturalD20(roll);
  const success = roll.total >= ctx.dc;
  const updates = { ...ctx.updates };
  const lines = [];
  const advisorLabel = ctx.advisor ? ADVISORS[ctx.advisor]?.label : null;
  const title = ctx.quell ? "Quell Unrest"
    : (ctx.label ?? `${ABILITIES[ctx.ability]} check${advisorLabel ? ` (${advisorLabel})` : ""}${ctx.petition ? " — petition" : ""}`);

  if ( ctx.quell && !ctx.reroll ) updates["system.usage.quell"] = sys.week;
  if ( ctx.quell ) {
    let delta = 0;
    if ( nat === 1 ) delta = 1;
    else if ( success ) {
      delta = nat === 20 ? -2 : -1;
      if ( R.hasFeat(snap, "endure-anarchy") && (sys.unrest >= 6) ) delta -= 1;
    }
    if ( delta ) {
      const { delta: d, notes } = unrestChange(actor, delta, {}, updates);
      lines.push(`Unrest ${d >= 0 ? "+" : ""}${d}${notes.length ? ` (${notes.join("; ")})` : ""} → ${updates["system.unrest"]}`);
      logUpdate(actor, `Quell Unrest (${roll.total} vs DC ${ctx.dc}): ${d >= 0 ? "+" : ""}${d} Unrest`, updates);
    } else {
      lines.push("Unrest unchanged");
      logUpdate(actor, `Quell Unrest failed (${roll.total} vs DC ${ctx.dc})`, updates);
    }
  }
  if ( !foundry.utils.isEmpty(updates) ) await actor.update(updates);

  // Reroll options
  const rerolls = [];
  if ( !ctx.reroll ) {
    if ( (nat === 1) && R.hasFeat(snap, "pull-together") && available(actor, "pull-together", "week") ) {
      rerolls.push({ key: "pull-together", label: "Pull Together (reroll the 1)" });
    }
    if ( !success && (ctx.ability === "stability") && R.hasBuilding(snap, "keep") && available(actor, "keep", "week") ) {
      rerolls.push({ key: "keep", label: "Keep (reroll failed Stability)" });
    }
    if ( !success && (ctx.ability === "culture") && R.hasBuilding(snap, "museum") && available(actor, "museum", "week") ) {
      rerolls.push({ key: "museum", label: "Museum (reroll failed Culture)" });
    }
    if ( !success && ctx.petition && ctx.advisor && R.hasFeat(snap, "trusted-counsel") && available(actor, "trusted-counsel", "week") ) {
      rerolls.push({ key: "trusted-counsel", label: "Trusted Counsel (advisor reroll)" });
    }
  }

  const outcome = success ? (nat === 20 ? "Success (natural 20)" : "Success") : (nat === 1 ? "Failure (natural 1)" : "Failure");
  const flavor = `<div class="ks-chat ks-check">
    <h3>${escape(title)}</h3>
    <p class="ks-dc">DC ${ctx.dc} — <strong class="${success ? "ks-success" : "ks-failure"}">${outcome}</strong></p>
    <p class="ks-parts">${ctx.parts.map(escape).join(" · ")}</p>
    ${ctx.notes?.length ? `<p class="ks-notes">${ctx.notes.map(escape).join(" · ")}</p>` : ""}
    ${lines.length ? `<p>${lines.map(escape).join("<br>")}</p>` : ""}
    ${ctx.reroll ? `<p class="ks-notes">Reroll: ${escape(ctx.reroll)}</p>` : ""}
    ${rerolls.length ? `<div class="ks-rerolls">${rerolls.map(r => `<button type="button" data-ks-reroll="${r.key}">${escape(r.label)}</button>`).join("")}</div>` : ""}
  </div>`;

  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    flags: {
      [MODULE_ID]: {
        check: {
          actorUuid: actor.uuid, ability: ctx.ability, dc: ctx.dc, quell: ctx.quell, advisor: ctx.advisor ?? "",
          petition: !!ctx.petition, label: ctx.label ?? null, parts: ctx.parts, formula: ctx.formula, data: ctx.data,
          unrestBefore: sys.unrest, total: roll.total, nat
        }
      }
    }
  });
}

/**
 * Handle a reroll button on a check chat card.
 */
export async function rerollFromMessage(message, key) {
  const check = message.getFlag(MODULE_ID, "check");
  if ( !check ) return;
  const actor = await fromUuid(check.actorUuid);
  if ( !actor?.isOwner ) return ui.notifications.warn("You don't own this kingdom.");
  if ( message.getFlag(MODULE_ID, "rerolled") ) return ui.notifications.warn("This check has already been rerolled.");
  if ( !available(actor, key, "week") ) return ui.notifications.warn("That reroll has already been used this week.");

  const updates = { [`system.usage.${key}`]: actor.system.week };
  // A rerolled Quell Unrest undoes the first result before applying the new one.
  if ( check.quell ) updates["system.unrest"] = check.unrestBefore;
  await actor.update(updates);
  await message.setFlag(MODULE_ID, "rerolled", true);

  const roll = await new Roll(check.formula, check.data).evaluate();
  const labels = { "pull-together": "Pull Together", keep: "Keep", museum: "Museum", "trusted-counsel": "Trusted Counsel" };
  return postCheck(actor, roll, {
    ability: check.ability, dc: check.dc, quell: check.quell, advisor: check.advisor, petition: check.petition,
    label: check.label, parts: check.parts, notes: [], updates: {}, formula: check.formula, data: check.data,
    reroll: `${labels[key] ?? key} — must use the new roll`
  });
}

/** Wire up reroll buttons in chat. */
export function onRenderChatMessage(message, html) {
  if ( !message.getFlag(MODULE_ID, "check") ) return;
  const buttons = html.querySelectorAll("[data-ks-reroll]");
  const done = message.getFlag(MODULE_ID, "rerolled");
  for ( const btn of buttons ) {
    if ( done ) {
      btn.disabled = true;
      continue;
    }
    btn.addEventListener("click", event => {
      event.preventDefault();
      btn.disabled = true;
      rerollFromMessage(message, btn.dataset.ksReroll);
    });
  }
}
