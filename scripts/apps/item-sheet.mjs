/**
 * Sheet for kingdom buildings and feats.
 */
import { ABILITIES, DISCOUNT_KEYS, FREQUENCIES, MODULE_ID, TYPES } from "../config.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export default class KingdomItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["kingdom-simplified", "ks-item-sheet"],
    position: { width: 520, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/item-sheet.hbs`, scrollable: [""] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const sys = item.system;
    const isBuilding = item.type === TYPES.building;
    const discountSet = new Set((sys.discounts ?? []).map(d => d.key));
    return Object.assign(context, {
      item, system: sys, isBuilding, isFeat: item.type === TYPES.feat, isAgreement: item.type === TYPES.agreement,
      editable: this.isEditable,
      abilityOptions: { "": "—", ...ABILITIES },
      frequencyOptions: FREQUENCIES,
      discounts: Object.entries(DISCOUNT_KEYS).map(([key, label]) => ({ key, label, checked: discountSet.has(key) })),
      enriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? "", {
        relativeTo: item, secrets: item.isOwner
      }),
      owned: !!item.parent
    });
  }

  /** Turn the discount checkboxes into the discounts array. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    if ( this.item.type !== TYPES.building ) return data;
    const keys = [...form.querySelectorAll("input[data-discount]:checked")].map(i => i.dataset.discount);
    const existing = new Map((this.item.system.discounts ?? []).map(d => [d.key, d.percent]));
    foundry.utils.setProperty(data, "system.discounts", keys.map(key => ({ key, percent: existing.get(key) ?? 20 })));
    return data;
  }
}
