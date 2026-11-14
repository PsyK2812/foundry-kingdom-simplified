/**
 * Pure rules math. No Foundry globals in here, so it can be tested in Node.
 *
 * A "snapshot" is a plain object:
 * {
 *   system:    the kingdom actor's system data (source-like plain object),
 *   buildings: [{ id, name, system }]   building items owned by the kingdom,
 *   feats:     [{ id, name, system }]   feat items owned by the kingdom
 * }
 */
import {
  ABILITIES, ADVANCEMENT, ADVISORS, ASI_LEVELS, GOVERNMENTS, HUNGER, MAX_LEVEL, NEW_SETTLEMENT_LEVELS,
  PROJECT_TYPES, SETTLEMENT_SIZES, SIZE_ORDER, UNREST_TIERS, renownForLevel
} from "./config.mjs";

/* -------------------------------------------- */
/*  Basics                                      */
/* -------------------------------------------- */

export function clampLevel(level) {
  return Math.min(Math.max(Number(level) || 1, 1), MAX_LEVEL);
}

export function advancement(level) {
  return ADVANCEMENT[clampLevel(level)];
}

export function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

export function unrestTier(unrest) {
  const u = Math.max(Number(unrest) || 0, 0);
  return UNREST_TIERS.find(t => u >= t.min);
}

export function hasFeat(snapshot, identifier) {
  return snapshot.feats.some(f => f.system.identifier === identifier);
}

export function featsByRule(snapshot, rule) {
  return snapshot.feats.filter(f => f.system.rule === rule || f.system.identifier === rule);
}

/** Buildings that count as built (assigned to a settlement). */
export function builtBuildings(snapshot) {
  const ids = new Set((snapshot.system.settlements ?? []).map(s => s.id));
  return snapshot.buildings.filter(b => ids.has(b.system.settlement));
}

export function capital(snapshot) {
  return (snapshot.system.settlements ?? []).find(s => s.capital) ?? null;
}

export function hasBuilding(snapshot, identifier, { inCapital=false }={}) {
  const cap = capital(snapshot);
  return builtBuildings(snapshot).some(b => (b.system.identifier === identifier)
    && (!inCapital || (cap && b.system.settlement === cap.id)));
}

export function countBuilding(snapshot, identifier) {
  return builtBuildings(snapshot).filter(b => b.system.identifier === identifier).length;
}

/* -------------------------------------------- */
/*  Usage tracking                              */
/* -------------------------------------------- */

/**
 * Is a limited-use ability available this week?
 * @param {object} usage      Map of key -> week last used.
 * @param {string} key
 * @param {"week"|"fourWeeks"|"none"} frequency
 * @param {number} week       Current kingdom week.
 */
export function isAvailable(usage, key, frequency, week) {
  const last = usage?.[key];
  if ( (last === undefined) || (last === null) ) return true;
  if ( frequency === "week" ) return last !== week;
  if ( frequency === "fourWeeks" ) return (week - last) >= 4;
  return true;
}

export function weeksUntilAvailable(usage, key, frequency, week) {
  if ( isAvailable(usage, key, frequency, week) ) return 0;
  if ( frequency === "week" ) return 1;
  return 4 - (week - usage[key]);
}

/* -------------------------------------------- */
/*  Abilities                                   */
/* -------------------------------------------- */

/**
 * Advisor roles that count as vacant.
 * @param {object} system
 * @param {boolean} deputyOk   Whether a Town Hall deputy may fill one vacant role.
 * @returns {{key: string, ability: string}[]}
 */
export function vacantRoles(system, deputyOk=false) {
  const vacant = [];
  let deputyUsed = false;
  for ( const [key, cfg] of Object.entries(ADVISORS) ) {
    const a = system.advisors?.[key] ?? {};
    const filled = (!!a.actorUuid || !!a.name) && !a.away;
    if ( filled ) continue;
    if ( deputyOk && a.deputy && !deputyUsed ) {
      deputyUsed = true;
      continue;
    }
    vacant.push({ key, ability: cfg.ability });
  }
  return vacant;
}

/** The role currently covered by the Town Hall deputy, if any. */
export function deputyRole(snapshot) {
  if ( !deputyAvailable(snapshot) ) return null;
  for ( const key of Object.keys(ADVISORS) ) {
    const a = snapshot.system.advisors?.[key] ?? {};
    const filled = (!!a.actorUuid || !!a.name) && !a.away;
    if ( !filled && a.deputy ) return key;
  }
  return null;
}

/** Does the capital have a Town Hall (lets a deputy fill one vacant role)? */
export function deputyAvailable(snapshot) {
  return hasBuilding(snapshot, "town-hall", { inCapital: true });
}

/**
 * Compute final ability scores with a breakdown.
 * Base portion (10 + setup bonuses + ASIs + manual) is capped at 20.
 * Building bonuses and vacancy penalties apply on top.
 */
export function abilityScores(snapshot) {
  const sys = snapshot.system;
  const out = {};
  const gov = GOVERNMENTS[sys.government];
  const vacant = vacantRoles(sys, deputyAvailable(snapshot));
  for ( const key of Object.keys(ABILITIES) ) {
    const parts = [{ label: "Base", value: 10 }];
    if ( gov?.abilities.includes(key) ) parts.push({ label: `Government (${gov.label})`, value: 2 });
    if ( gov && sys.setup?.governmentChoice === key ) parts.push({ label: "Government choice", value: 2 });
    if ( sys.setup?.freeChoice === key ) parts.push({ label: "Free increase", value: 2 });
    for ( const src of ["heartland", "sponsor"] ) {
      const s = sys.setup?.[src];
      const name = s?.label || (src === "heartland" ? "Heartland" : "Sponsor");
      if ( s?.ability === key && s.bonus ) parts.push({ label: name, value: Number(s.bonus) });
      if ( s?.ability2 === key && s.bonus2 ) parts.push({ label: name, value: Number(s.bonus2) });
    }
    for ( const lvl of ASI_LEVELS ) {
      if ( (sys.level >= lvl) && (sys.asi?.[lvl] === key) ) parts.push({ label: `Ability Score Improvement (level ${lvl})`, value: 2 });
    }
    const manual = Number(sys.abilities?.[key]?.adjustment) || 0;
    if ( manual ) parts.push({ label: "Manual adjustment", value: manual });
    let base = parts.reduce((t, p) => t + p.value, 0);
    if ( base > 20 ) {
      parts.push({ label: "Capped at 20", value: 20 - base });
      base = 20;
    }

    // Buildings: each bonus applies once per kingdom, regardless of how many copies are built.
    const seen = new Set();
    for ( const b of builtBuildings(snapshot) ) {
      const ab = b.system.ability;
      if ( (ab?.key === key) && ab.value && !seen.has(b.system.identifier) ) {
        seen.add(b.system.identifier);
        parts.push({ label: b.name, value: Number(ab.value) });
      }
    }
    const vacancies = vacant.filter(v => v.ability === key).length;
    if ( vacancies ) parts.push({ label: `Vacant advisor role${vacancies > 1 ? "s" : ""}`, value: -2 * vacancies });

    const total = parts.reduce((t, p) => t + p.value, 0);
    out[key] = { label: ABILITIES[key], total, mod: abilityMod(total), parts };
  }
  return out;
}

/** Flat bonuses that apply to every check (University) or a specific ability. */
export function checkBonuses(snapshot, ability) {
  const bonuses = [];
  if ( hasBuilding(snapshot, "university") ) bonuses.push({ label: "University", value: 1 });
  if ( (ability === "culture") && hasFeat(snapshot, "inspiring-entertainment") && (snapshot.system.unrest >= 5) ) {
    bonuses.push({ label: "Inspiring Entertainment", value: 2 });
  }
  return bonuses;
}

/* -------------------------------------------- */
/*  Settlements                                 */
/* -------------------------------------------- */

export function settlementsAllowed(level) {
  return NEW_SETTLEMENT_LEVELS.filter(l => l <= level).length;
}

export function sizeUnlocked(size, level) {
  return (SETTLEMENT_SIZES[size]?.level ?? 99) <= level;
}

export function nextSize(size) {
  const i = SIZE_ORDER.indexOf(size);
  return SIZE_ORDER[i + 1] ?? null;
}

export function settlementBuildings(snapshot, settlementId) {
  return snapshot.buildings.filter(b => b.system.settlement === settlementId);
}

export function settlementSlots(snapshot, settlement) {
  const buildings = settlementBuildings(snapshot, settlement.id);
  let total = SETTLEMENT_SIZES[settlement.size]?.slots ?? 0;
  const parts = [{ label: SETTLEMENT_SIZES[settlement.size]?.label ?? "?", value: total }];
  for ( const b of buildings ) {
    if ( b.system.slotBonus ) {
      total += b.system.slotBonus;
      parts.push({ label: b.name, value: b.system.slotBonus });
    }
  }
  if ( settlement.capital && hasFeat(snapshot, "grand-capital") ) {
    total += 10;
    parts.push({ label: "Grand Capital", value: 10 });
  }
  const used = buildings.reduce((t, b) => t + (Number(b.system.slots) || 0), 0);
  return { total, used, free: total - used, parts };
}

/**
 * Check whether a building can go into a settlement. Returns a list of problems (empty = fine).
 * @param {object} snapshot
 * @param {object} building     { name, system }
 * @param {object} settlement
 */
export function validateBuilding(snapshot, building, settlement) {
  const problems = [];
  const sys = building.system;
  const level = snapshot.system.level;
  if ( (sys.level ?? 1) > level ) problems.push(`${building.name} needs kingdom level ${sys.level}.`);
  const slots = settlementSlots(snapshot, settlement);
  if ( (Number(sys.slots) || 0) > slots.free ) problems.push(`${settlement.name} has ${slots.free} free slot(s); ${building.name} needs ${sys.slots}.`);
  const here = settlementBuildings(snapshot, settlement.id);
  if ( here.some(b => (b.system.identifier === sys.identifier) && (b.id !== building.id)) ) {
    problems.push(`${settlement.name} already has a ${building.name}.`);
  }
  if ( sys.requires?.capital && !settlement.capital ) problems.push(`${building.name} can only be built in your capital.`);
  if ( sys.requires?.river ) {
    const aqueduct = (sys.identifier === "mill") && here.some(b => b.system.identifier === "aqueduct");
    if ( !settlement.river && !aqueduct ) problems.push(`${building.name} needs a settlement beside a river or lake.`);
  }
  if ( sys.requires?.hills && !settlement.hills ) problems.push(`${building.name} needs a settlement next to a hills or mountains hex.`);
  if ( (sys.identifier === "wooden-wall") && here.some(b => b.system.identifier === "stone-wall") ) {
    problems.push(`${settlement.name} already has a Stone Wall.`);
  }
  return problems;
}

/* -------------------------------------------- */
/*  Resource Points                             */
/* -------------------------------------------- */

/**
 * Number of d10s in the weekly Resource Points roll, with a breakdown.
 */
export function rpDicePool(snapshot) {
  const sys = snapshot.system;
  const parts = [];
  const agreements = sys.tradeAgreements ?? [];
  for ( const t of agreements ) {
    if ( t.dice ) parts.push({ label: `Trade: ${t.name || "agreement"}`, value: Number(t.dice) });
  }
  const built = builtBuildings(snapshot);
  for ( const b of built ) {
    if ( b.system.rpDice ) parts.push({ label: b.name, value: Number(b.system.rpDice) });
  }

  // Smithy: each Lumberyard, Mine, and Stonemason in the same settlement adds 1 more d10.
  for ( const smithy of built.filter(b => b.system.identifier === "smithy") ) {
    const synergy = built.filter(b => (b.system.settlement === smithy.system.settlement)
      && ["lumberyard", "mine", "stonemason"].includes(b.system.identifier)).length;
    if ( synergy ) parts.push({ label: "Smithy synergy", value: synergy });
  }

  if ( hasFeat(snapshot, "thriving-economy") ) parts.push({ label: "Thriving Economy", value: 2 });
  if ( hasFeat(snapshot, "trade-network") && agreements.length ) {
    parts.push({ label: "Trade Network", value: agreements.length });
  }
  for ( const e of sys.events ?? [] ) {
    if ( e.dice ) parts.push({ label: `Event: ${e.name || "event"}`, value: Number(e.dice) });
  }
  if ( sys.pendingDice ) parts.push({ label: "Bonus dice this week", value: Number(sys.pendingDice) });
  const total = Math.max(parts.reduce((t, p) => t + p.value, 0), 0);
  return { total, parts };
}

/** Flat RP added after the roll (Menagerie visitors). */
export function rpFlatIncome(snapshot) {
  const parts = [];
  for ( const b of builtBuildings(snapshot).filter(b => b.system.identifier === "menagerie") ) {
    const creatures = Math.min(Number(b.system.counter) || 0, 4);
    if ( creatures ) parts.push({ label: `${b.name} (${creatures} creature${creatures > 1 ? "s" : ""})`, value: creatures * 5 });
  }
  return { total: parts.reduce((t, p) => t + p.value, 0), parts };
}

/** Fraction of the RP roll lost to Hunger. */
export function hungerReduction(snapshot) {
  const h = Number(snapshot.system.hunger) || 0;
  if ( (h === 1) && hasFeat(snapshot, "hardy-folk") ) return 0;
  return HUNGER[h]?.rpReduction ?? 0;
}

export function applyHungerToRoll(rolled, reduction) {
  return Math.floor(rolled * (1 - reduction));
}

/** Number of dice the Guildhall lets you reroll on 1s. */
export function guildhallRerolls(snapshot) {
  return hasBuilding(snapshot, "guildhall") ? advancement(snapshot.system.level).prof : 0;
}

/* -------------------------------------------- */
/*  Food                                        */
/* -------------------------------------------- */

export function foodProduction(snapshot) {
  const sys = snapshot.system;
  const parts = [];
  const farmland = Number(sys.farmland) || 0;
  if ( farmland ) parts.push({ label: "Farmland", value: farmland });
  const built = builtBuildings(snapshot);
  for ( const b of built ) {
    let food = Number(b.system.food) || 0;
    if ( b.system.identifier === "stockyard" ) {
      // Slaughter: +4 the week it's used, nothing the week after.
      if ( b.system.special === sys.week ) food += 4;
      else if ( (b.system.special !== null) && (b.system.special !== undefined) && (b.system.special === sys.week - 1) ) food = 0;
    }
    if ( food ) parts.push({ label: b.name, value: food });
  }
  // Orchard: +1 Food per Farmland hex next to it, up to 3 per Orchard.
  // Each Orchard stores how many Farmland hexes are next to it (0-3) in its counter.
  for ( const b of built.filter(b => b.system.identifier === "orchard") ) {
    const next = Math.min(Math.max(Number(b.system.counter) || 0, 0), 3);
    if ( next ) parts.push({ label: `${b.name} (${next} Farmland next to it)`, value: next });
  }
  for ( const e of sys.events ?? [] ) {
    if ( e.food ) parts.push({ label: `Event: ${e.name || "event"}`, value: Number(e.food) });
  }
  return { total: parts.reduce((t, p) => t + p.value, 0), parts };
}

export function foodConsumption(snapshot) {
  const sys = snapshot.system;
  const parts = [];
  for ( const s of sys.settlements ?? [] ) {
    parts.push({ label: s.name || "Settlement", value: SETTLEMENT_SIZES[s.size]?.food ?? 0 });
  }
  if ( sys.army?.food ) parts.push({ label: "Armies", value: Number(sys.army.food) });
  return { total: parts.reduce((t, p) => t + p.value, 0), parts };
}

export function hungerAfter(hunger, supplies) {
  const h = Number(hunger) || 0;
  if ( supplies < 0 ) return Math.min(h + 1, 3);
  if ( supplies > 0 ) return Math.max(h - 1, 0);
  return h;
}

/* -------------------------------------------- */
/*  Petitions & Unrest                          */
/* -------------------------------------------- */

/**
 * Unrest for missing a petition day.
 * @param {number} streak   How many petition days in a row are now missed, including this one.
 * @param {boolean} openDoor
 */
export function missedPetitionUnrest(streak, openDoor=false) {
  if ( openDoor && (streak === 1) ) return 0;
  if ( streak <= 4 ) return 1;
  if ( streak <= 8 ) return 2;
  return 3;
}

/* -------------------------------------------- */
/*  Projects                                    */
/* -------------------------------------------- */

export function maxActiveProjects(snapshot) {
  let n = advancement(snapshot.system.level).projects;
  if ( hasBuilding(snapshot, "palace", { inCapital: true }) ) n += 1;
  return n;
}

export function maxFocus(snapshot) {
  return hasBuilding(snapshot, "castle", { inCapital: true }) ? 2 : 1;
}

/** Discount percent (0-1) for a project from buildings. */
export function projectDiscount(snapshot, discountKey) {
  let best = 0;
  let source = null;
  for ( const b of builtBuildings(snapshot) ) {
    for ( const d of b.system.discounts ?? [] ) {
      if ( (d.key === discountKey) && (d.percent / 100 > best) ) {
        best = d.percent / 100;
        source = b.name;
      }
    }
  }
  return { percent: best, source };
}

/**
 * Final RP cost of a project.
 * base x (1 + Unrest surcharge) x (1 - discount), rounded up.
 */
export function projectCost(snapshot, type, baseCost, { masterpieceKind }={}) {
  const cfg = PROJECT_TYPES[type];
  let key = cfg?.discountKey;
  if ( type === "masterpiece" ) key = masterpieceKind === "arms" ? "masterpieceArms" : "masterpieceMagic";
  const tier = unrestTier(snapshot.system.unrest);
  const discount = projectDiscount(snapshot, key);
  // Agreements add to the Unrest surcharge on building construction.
  const agreement = type === "buildStructure" ? agreementSurcharge(snapshot) : { percent: 0, parts: [] };
  const base = Math.max(Number(baseCost) || 0, 0);
  const final = Math.ceil(base * (1 + tier.surcharge + agreement.percent) * (1 - discount.percent) - 1e-9);
  return {
    base, surcharge: tier.surcharge, agreementSurcharge: agreement.percent, agreementParts: agreement.parts,
    discount: discount.percent, discountSource: discount.source, final
  };
}

/* -------------------------------------------- */
/*  Agreements                                  */
/* -------------------------------------------- */

/** Agreements that still have debt outstanding. */
export function activeAgreements(snapshot) {
  return (snapshot.agreements ?? []).filter(a => (a.system.signedWeek !== null) && (a.system.debt > 0));
}

/** Total building surcharge (0-1) from agreements with debt outstanding. */
export function agreementSurcharge(snapshot) {
  const parts = activeAgreements(snapshot).filter(a => a.system.surcharge)
    .map(a => ({ label: a.system.partner || a.name, value: a.system.surcharge }));
  return { percent: parts.reduce((t, p) => t + p.value, 0) / 100, parts };
}

/** The minimum still owed this period (never more than the remaining debt). */
export function agreementMinimumDue(agreement) {
  const s = agreement.system;
  return Math.max(Math.min(s.minPayment, s.debt + s.paidThisPeriod) - s.paidThisPeriod, 0);
}

/** Last week of the agreement's current payment period. */
export function agreementPeriodEnd(agreement) {
  const s = agreement.system;
  return (s.periodStart ?? s.signedWeek ?? 1) + Math.max(s.periodWeeks, 1) - 1;
}

/**
 * What happens to an agreement at the end of a week.
 * @returns {null|{missed: boolean, surcharge: number, periodStart: number}} null when the period isn't over.
 */
export function agreementWeekEnd(agreement, week) {
  const s = agreement.system;
  if ( (s.signedWeek === null) || (s.debt <= 0) ) return null;
  if ( week < agreementPeriodEnd(agreement) ) return null;
  const missed = agreementMinimumDue(agreement) > 0;
  return { missed, surcharge: s.surcharge + (missed ? s.surchargeStep : 0), periodStart: week + 1 };
}

/** Normal weeks for projects whose duration the rules define. Returns null when the GM decides. */
export function projectWeeks(type, { buildingCost, hexes }={}) {
  if ( type === "buildStructure" ) return Math.max(Math.ceil((Number(buildingCost) || 0) / 25), 1);
  if ( type === "buildRoad" ) return Math.max(Number(hexes) || 1, 1);
  if ( type === "establishFarmland" ) return PROJECT_TYPES.establishFarmland.weeks;
  return null;
}

/** Chance (0-1) that each project stalls this week because of Hunger. */
export function projectStallChance(snapshot) {
  return HUNGER[Number(snapshot.system.hunger) || 0]?.stallChance ?? 0;
}

/** Weeks of progress a project gains this turn (before any Hunger stall roll). */
export function projectProgress(snapshot, project) {
  let rate = project.focus ? 2 : 1;
  if ( (project.type === "masterpiece") && hasFeat(snapshot, "master-artisans") ) rate *= 2;
  return rate;
}

/* -------------------------------------------- */
/*  Levels                                      */
/* -------------------------------------------- */

export function renownNeeded(level) {
  return clampLevel(level) >= MAX_LEVEL ? null : renownForLevel(clampLevel(level));
}

/** How many levels can be gained right now, and the Renown left over. */
export function pendingLevels(level, renown) {
  let lvl = clampLevel(level);
  let r = Number(renown) || 0;
  let gained = 0;
  while ( lvl < MAX_LEVEL && r >= renownForLevel(lvl) ) {
    r -= renownForLevel(lvl);
    lvl += 1;
    gained += 1;
  }
  return { gained, level: lvl, renown: r };
}

export function featSlots(level) {
  let n = 0;
  for ( let l = 2; l <= clampLevel(level); l += 2 ) n += 1;
  return n;
}
