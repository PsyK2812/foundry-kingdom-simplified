/**
 * Static rules data for Kingdom Rules (Simplified).
 * Everything here is plain data so it can be unit-tested outside Foundry.
 */

export const MODULE_ID = "kingdom-simplified";
export const TYPES = {
  kingdom: `${MODULE_ID}.kingdom`,
  building: `${MODULE_ID}.building`,
  feat: `${MODULE_ID}.feat`,
  agreement: `${MODULE_ID}.agreement`
};

export const ABILITIES = {
  culture: "Culture",
  economy: "Economy",
  stability: "Stability",
  loyalty: "Loyalty"
};

/** Government: two fixed +2 increases, plus a free +2 to a third ability. */
export const GOVERNMENTS = {
  despotism: { label: "Despotism", abilities: ["stability", "economy"] },
  feudalism: { label: "Feudalism", abilities: ["stability", "culture"] },
  oligarchy: { label: "Oligarchy", abilities: ["loyalty", "economy"] },
  republic: { label: "Republic", abilities: ["stability", "loyalty"] },
  thaumocracy: { label: "Thaumocracy", abilities: ["economy", "culture"] },
  yeomanry: { label: "Yeomanry", abilities: ["loyalty", "culture"] }
};

export const ADVISORS = {
  counselor: { label: "Counselor", ability: "culture" },
  magister: { label: "Magister", ability: "culture" },
  treasurer: { label: "Treasurer", ability: "economy" },
  viceroy: { label: "Viceroy", ability: "economy" },
  general: { label: "General", ability: "stability" },
  warden: { label: "Warden", ability: "stability" },
  ruler: { label: "Ruler", ability: "loyalty" },
  emissary: { label: "Emissary", ability: "loyalty" }
};

/** Kingdom Advancement Table, index = level. */
export const ADVANCEMENT = {
  1: { prof: 2, dc: 14, projects: 1, features: ["Village", "New settlement"] },
  2: { prof: 2, dc: 14, projects: 1, features: ["Kingdom feat"] },
  3: { prof: 2, dc: 14, projects: 1, features: ["New settlement"] },
  4: { prof: 2, dc: 14, projects: 2, features: ["Ability Score Improvement", "Kingdom feat"] },
  5: { prof: 3, dc: 15, projects: 2, features: ["Town"] },
  6: { prof: 3, dc: 15, projects: 2, features: ["Kingdom feat"] },
  7: { prof: 3, dc: 15, projects: 2, features: ["New settlement"] },
  8: { prof: 3, dc: 15, projects: 3, features: ["Ability Score Improvement", "Kingdom feat"] },
  9: { prof: 4, dc: 16, projects: 3, features: ["New settlement"] },
  10: { prof: 4, dc: 16, projects: 3, features: ["Kingdom feat"] },
  11: { prof: 4, dc: 16, projects: 3, features: ["City"] },
  12: { prof: 4, dc: 16, projects: 4, features: ["Ability Score Improvement", "Kingdom feat"] },
  13: { prof: 5, dc: 17, projects: 4, features: ["New settlement"] },
  14: { prof: 5, dc: 17, projects: 4, features: ["Kingdom feat"] },
  15: { prof: 5, dc: 17, projects: 4, features: ["New settlement"] },
  16: { prof: 5, dc: 17, projects: 5, features: ["Ability Score Improvement", "Kingdom feat"] },
  17: { prof: 6, dc: 18, projects: 5, features: ["Metropolis"] },
  18: { prof: 6, dc: 18, projects: 5, features: ["Kingdom feat"] },
  19: { prof: 6, dc: 18, projects: 5, features: ["Ability Score Improvement"] },
  20: { prof: 6, dc: 18, projects: 5, features: ["Kingdom feat"] }
};

export const MAX_LEVEL = 20;
export const ASI_LEVELS = [4, 8, 12, 16, 19];
export const NEW_SETTLEMENT_LEVELS = [1, 3, 7, 9, 13, 15];

/** DC adjustments the GM can pick. */
export const DIFFICULTIES = {
  easy: { label: "Easy (−2)", mod: -2 },
  normal: { label: "Normal", mod: 0 },
  hard: { label: "Hard (+2)", mod: 2 },
  veryHard: { label: "Very hard (+5)", mod: 5 }
};

export const SETTLEMENT_SIZES = {
  village: { label: "Village", slots: 9, food: 1, level: 1, expandCost: null },
  town: { label: "Town", slots: 16, food: 3, level: 5, expandCost: 100 },
  city: { label: "City", slots: 25, food: 6, level: 11, expandCost: 200 },
  metropolis: { label: "Metropolis", slots: 36, food: 10, level: 17, expandCost: 300 }
};
export const SIZE_ORDER = ["village", "town", "city", "metropolis"];

/** Unrest tiers: [minimum unrest, check penalty, project cost surcharge]. */
export const UNREST_TIERS = [
  { min: 15, penalty: 4, surcharge: 0.5 },
  { min: 10, penalty: 3, surcharge: 0.3 },
  { min: 5, penalty: 2, surcharge: 0.2 },
  { min: 1, penalty: 1, surcharge: 0.1 },
  { min: 0, penalty: 0, surcharge: 0 }
];

/** Hunger level effects. */
export const HUNGER = {
  0: { unrest: 0, rpReduction: 0, stallChance: 0 },
  1: { unrest: 1, rpReduction: 0.25, stallChance: 0 },
  2: { unrest: 2, rpReduction: 0.5, stallChance: 0 },
  3: { unrest: 3, rpReduction: 0.5, stallChance: 0.5 }
};

export const MASTERPIECE = {
  uncommon: { label: "Uncommon", cost: 75, level: 1 },
  rare: { label: "Rare", cost: 150, level: 5 },
  veryRare: { label: "Very rare", cost: 300, level: 10 },
  legendary: { label: "Legendary", cost: 600, level: 15 }
};

/**
 * Project types. `discountKey` matches building discount keys.
 * `renown` = earns 1 Renown on completion.
 */
export const PROJECT_TYPES = {
  buildStructure: { label: "Build Structure", discountKey: "buildStructure", renown: "firstOfType" },
  buildRoad: { label: "Build Road", discountKey: "buildRoad", renown: false, costPerHex: 25 },
  establishFarmland: { label: "Establish Farmland", discountKey: "establishFarmland", renown: false, cost: 40, weeks: 3 },
  expandSettlement: { label: "Expand Settlement", discountKey: "expandSettlement", renown: true, growingPains: true },
  claimTerritory: { label: "Claim Territory", discountKey: "claimTerritory", renown: true, growingPains: true },
  masterpiece: { label: "Create a Masterpiece", discountKey: "masterpiece", renown: true },
  research: { label: "Research", discountKey: "research", renown: false },
  infiltration: { label: "Infiltration", discountKey: "infiltration", renown: false },
  sendEnvoy: { label: "Send Envoy", discountKey: "sendEnvoy", renown: true }
};

/** Discount keys a building can grant (20% each in the current rules). */
export const DISCOUNT_KEYS = {
  buildStructure: "Build Structure",
  buildRoad: "Build Road",
  establishFarmland: "Establish Farmland",
  expandSettlement: "Expand Settlement",
  claimTerritory: "Claim Territory",
  masterpieceArms: "Masterpiece (weapons & armor)",
  masterpieceMagic: "Masterpiece (other magic items)",
  research: "Research",
  infiltration: "Infiltration",
  sendEnvoy: "Send Envoy"
};

export const FREQUENCIES = {
  none: "—",
  week: "Once per week",
  fourWeeks: "Once every 4 weeks"
};

export const RESOURCE_PURCHASE = { gpPerRp: 25, bankGpPerRp: 20, maxPerWeek: 50 };

/** Renown needed to reach the next level, by current level. */
export function renownForLevel(level) {
  if ( level <= 4 ) return 5;
  if ( level <= 9 ) return 8;
  if ( level <= 14 ) return 12;
  return 15;
}
