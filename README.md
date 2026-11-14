# Kingdom Rules (Simplified)

Foundry VTT module for the simplified Kingmaker kingdom rules, on the D&D 5e system.

- Foundry: v14 (verified on build 370; needs 14.367+)
- System: dnd5e 6.0.5+ (works with 6.1.0)

## Install

In Foundry's **Add-on Modules → Install Module**, paste this manifest URL:

```
https://raw.githubusercontent.com/PsyK2812/foundry-kingdom-simplified/main/module.json
```

Then enable **Kingdom Rules (Simplified)** in your world under Manage Modules. Updates show up in Foundry's module list.

## Getting started

1. Create an Actor of type **Kingdom**. Give your players Owner permission on it.
2. On the **Kingdom** tab, set the government, the free increases, heartland and sponsor.
3. On **Settlements**, add the first settlement (it becomes the capital) and tick River/lake or Hills if they apply.
4. Drag buildings from the **Kingdom Buildings** compendium onto a settlement, and feats from **Kingdom Feats** onto the sheet.
5. On **Advisors**, drag characters onto roles or type NPC names.
6. Each week, the GM clicks **Weekly turn** in the sheet header.

## What's automated

- Ability scores, modifiers, proficiency, DC, vacant-role penalties, building ability bonuses
- RP dice pool (trade, buildings, Smithy synergy, feats, events, bonus dice), Guildhall rerolls, Hunger reduction
- Food production and consumption, Hunger, Granary, Stockyard slaughter
- Project cost (Unrest surcharge, building discounts, Mansion), duration, focus, completion results
- First-build Unrest and Renown, Growing Pains, Theater, Famed Realm, level-up
- Quell Unrest, Kingdom Assurance, Brewery, Bathhouse, Arena, Palace, Town Hall deputy
- Reroll buttons in chat: Pull Together, Keep, Museum, Trusted Counsel
- Kingdom actions: trade fair, tournament, tithes, black market, debase coinage, holiday, festival, hire adventurers
- Buying RP (Bank rate) and Bank loans
- Agreements (Kingdom Agreements compendium): RP on signing, building surcharge while in debt, monthly minimum payment checked in the weekly turn

Party perks (Shrine blessing, Park, Monument and so on) are shown with a "used this week" checkbox.

## Development

- `npm install`
- `node tools/build-packs.mjs` rebuilds the compendiums from `src/packs/*.yaml`
- `node tools/test-rules.mjs` and `node tools/smoke-test.mjs` run the tests
- `npm run release` rebuilds the packs and `kingdom-simplified.zip` (bump `version` in `module.json` first)
