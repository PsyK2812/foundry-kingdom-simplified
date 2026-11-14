import { ABILITIES, ADVISORS, ASI_LEVELS, GOVERNMENTS, MAX_LEVEL, SETTLEMENT_SIZES, TYPES } from "../config.mjs";
import * as R from "../rules.mjs";

const {
  ArrayField, BooleanField, NumberField, ObjectField, SchemaField, StringField
} = foundry.data.fields;

const int = (initial=0, opts={}) => new NumberField({ required: true, nullable: false, integer: true, initial, ...opts });
const str = (initial="", opts={}) => new StringField({ required: true, blank: true, initial, ...opts });
const bool = (initial=false) => new BooleanField({ initial });

const abilityChoice = () => new StringField({
  required: true, blank: true, initial: "", choices: { "": "—", ...ABILITIES }
});

/**
 * System data for the Kingdom actor.
 */
export default class KingdomData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      level: int(1, { min: 1, max: MAX_LEVEL }),
      renown: int(0, { min: 0 }),
      rp: int(0, { min: 0 }),
      unrest: int(0, { min: 0 }),
      hunger: int(0, { min: 0, max: 3 }),
      week: int(1, { min: 1 }),
      farmland: int(1, { min: 0 }),
      claimedHexes: int(1, { min: 0 }),

      government: new StringField({ required: true, blank: true, initial: "",
        choices: { "": "—", ...Object.fromEntries(Object.entries(GOVERNMENTS).map(([k, v]) => [k, v.label])) } }),

      setup: new SchemaField({
        governmentChoice: abilityChoice(),
        freeChoice: abilityChoice(),
        heartland: new SchemaField({ label: str(), ability: abilityChoice(), bonus: int(0), ability2: abilityChoice(), bonus2: int(0) }),
        sponsor: new SchemaField({ label: str(), ability: abilityChoice(), bonus: int(0), ability2: abilityChoice(), bonus2: int(0) })
      }),

      abilities: new SchemaField(Object.fromEntries(Object.keys(ABILITIES).map(k => [k, new SchemaField({
        adjustment: int(0)
      })]))),

      asi: new SchemaField(Object.fromEntries(ASI_LEVELS.map(l => [l, abilityChoice()]))),

      advisors: new SchemaField(Object.fromEntries(Object.keys(ADVISORS).map(k => [k, new SchemaField({
        actorUuid: str(),
        name: str(),
        away: bool(),
        deputy: bool()
      })]))),

      missedPetitions: int(0, { min: 0 }),
      pendingDice: int(0),
      holidayWeek: new NumberField({ required: true, nullable: true, integer: true, initial: null }),
      lastRenownWeek: new NumberField({ required: true, nullable: true, integer: true, initial: null }),
      resourcesBought: new SchemaField({ week: int(0), amount: int(0) }),

      tradeAgreements: new ArrayField(new SchemaField({
        id: str(), name: str(), dice: int(1, { min: 0 })
      })),

      settlements: new ArrayField(new SchemaField({
        id: str(),
        name: str("New settlement"),
        size: new StringField({ required: true, initial: "village", choices: Object.fromEntries(
          Object.entries(SETTLEMENT_SIZES).map(([k, v]) => [k, v.label])) }),
        capital: bool(),
        river: bool(),
        hills: bool(),
        notes: str()
      })),

      projects: new ArrayField(new SchemaField({
        id: str(),
        type: str("buildStructure"),
        name: str(),
        cost: int(0, { min: 0 }),
        weeksNeeded: new NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null }),
        weeksDone: int(0, { min: 0 }),
        focus: bool(),
        settlement: str(),
        buildingUuid: str(),
        hexes: int(1, { min: 1 }),
        notes: str()
      })),

      events: new ArrayField(new SchemaField({
        id: str(),
        name: str("Event"),
        weeksLeft: new NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null }),
        dice: int(0),
        food: int(0),
        notes: str()
      })),

      army: new SchemaField({
        upkeep: int(0, { min: 0 }),
        food: int(0, { min: 0 })
      }),

      loan: new SchemaField({
        amount: int(0, { min: 0 }),
        dueWeek: new NumberField({ required: true, nullable: true, integer: true, initial: null })
      }),

      /** Limited-use tracking: key -> week last used. */
      usage: new ObjectField(),

      /** Building identifiers the kingdom has ever built (for first-of-type Renown and Unrest). */
      builtTypes: new ArrayField(str()),

      log: new ArrayField(new SchemaField({
        week: int(1),
        text: str()
      })),

      notes: str()
    };
  }

  /* -------------------------------------------- */

  /**
   * Plain snapshot of the kingdom for the rules functions.
   * @returns {{system: object, buildings: object[], feats: object[]}}
   */
  get snapshot() {
    const items = this.parent?.items ?? [];
    return {
      system: this,
      buildings: items.filter(i => i.type === TYPES.building).map(i => ({ id: i.id, name: i.name, system: i.system })),
      feats: items.filter(i => i.type === TYPES.feat).map(i => ({ id: i.id, name: i.name, system: i.system })),
      agreements: items.filter(i => i.type === TYPES.agreement).map(i => ({ id: i.id, name: i.name, system: i.system }))
    };
  }

  /** @override */
  prepareDerivedData() {
    const adv = R.advancement(this.level);
    this.prof = adv.prof;
    this.dc = adv.dc;
    this.unrestTier = R.unrestTier(this.unrest);
    this.renownNeeded = R.renownNeeded(this.level);
  }

  /**
   * Values that depend on owned items. Computed lazily because items are prepared after the actor's system data.
   */
  get derived() {
    const snap = this.snapshot;
    return {
      abilities: R.abilityScores(snap),
      dicePool: R.rpDicePool(snap),
      flatIncome: R.rpFlatIncome(snap),
      production: R.foodProduction(snap),
      consumption: R.foodConsumption(snap),
      maxProjects: R.maxActiveProjects(snap),
      maxFocus: R.maxFocus(snap),
      settlementsAllowed: R.settlementsAllowed(this.level),
      vacant: R.vacantRoles(this, R.deputyAvailable(snap))
    };
  }
}
