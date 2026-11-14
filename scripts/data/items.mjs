import { ABILITIES, DISCOUNT_KEYS, FREQUENCIES } from "../config.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

const int = (initial=0, opts={}) => new NumberField({ required: true, nullable: false, integer: true, initial, ...opts });
const str = (initial="", opts={}) => new StringField({ required: true, blank: true, initial, ...opts });
const frequency = () => new StringField({ required: true, initial: "none", choices: FREQUENCIES });
const abilityChoice = () => new StringField({ required: true, blank: true, initial: "", choices: { "": "—", ...ABILITIES } });

/**
 * A kingdom building. Structured fields drive the math; `description` holds the full rules text.
 */
export class BuildingData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    return {
      identifier: str(),
      level: int(1, { min: 1, max: 20 }),
      slots: int(1, { min: 0 }),
      cost: int(0, { min: 0 }),
      rpDice: int(0),
      food: int(0),
      ability: new SchemaField({ key: abilityChoice(), value: int(0) }),
      discounts: new ArrayField(new SchemaField({
        key: new StringField({ required: true, initial: "buildStructure", choices: DISCOUNT_KEYS }),
        percent: int(20, { min: 0, max: 100 })
      })),
      requires: new SchemaField({
        river: new BooleanField(),
        hills: new BooleanField(),
        capital: new BooleanField()
      }),
      slotBonus: int(0),
      unrestOnBuild: int(0),
      unrestFirstBuild: int(0),
      clearsUnrest: new BooleanField(),
      perk: new SchemaField({ frequency: frequency(), label: str() }),
      description: new HTMLField({ required: true, blank: true }),

      // Per-copy state once placed in a kingdom
      settlement: str(),
      counter: int(0, { min: 0 }),
      special: new NumberField({ required: true, nullable: true, integer: true, initial: null })
    };
  }
}

/**
 * A deal with an outside party: RP up front, a debt to repay, and a building surcharge until it's repaid.
 */
export class AgreementData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const nullableInt = () => new NumberField({ required: true, nullable: true, integer: true, initial: null });
    return {
      identifier: str(),
      partner: str(),
      loan: int(100, { min: 0 }),
      repayTotal: int(100, { min: 0 }),
      surcharge: int(20, { min: 0 }),
      surchargeStep: int(5, { min: 0 }),
      minPayment: int(5, { min: 0 }),
      periodWeeks: int(4, { min: 1 }),
      description: new HTMLField({ required: true, blank: true }),

      // State once signed by a kingdom
      signedWeek: nullableInt(),
      debt: int(0, { min: 0 }),
      periodStart: nullableInt(),
      paidThisPeriod: int(0, { min: 0 }),
      missed: int(0, { min: 0 })
    };
  }
}

/**
 * A kingdom feat.
 */
export class FeatData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    return {
      identifier: str(),
      prerequisite: int(0, { min: 0, max: 20 }),
      repeatable: new BooleanField(),
      ability: abilityChoice(),
      perk: new SchemaField({ frequency: frequency(), label: str() }),
      description: new HTMLField({ required: true, blank: true })
    };
  }
}
