export type MenuCategory = "FIT" | "LOWCARB" | "CALDOS";

export type MenuItem = {
  id: string;
  name: string;
  category: MenuCategory;
  description?: string;
  images?: string[]; // URLs das imagens
};

export type PricingRuleType = "UNITARY" | "QUANTITY_COMBO" | "MIXED_COMBO";

export type PricingRule = {
  id: string;
  category: MenuCategory;
  type: PricingRuleType;
  price: number;
  quantity?: number; // para QUANTITY_COMBO
  mixQuantities?: { category: MenuCategory; quantity: number }[]; // para MIXED_COMBO
};

export type SavedMenuVersion = {
  id: string;
  name: string;
  createdAt: string;
  items: MenuItem[];
  pricingRules: PricingRule[];
};

export type MenuData = {
  items: MenuItem[];
  pricingRules: PricingRule[];
};

export type ParsedSelection = {
  item: MenuItem;
  quantity: number;
};

export type AppliedCombo = {
  rule: PricingRule;
  savings: number;
};
