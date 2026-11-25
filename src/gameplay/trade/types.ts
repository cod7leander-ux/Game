export const TRADE_RESOURCES = [
  'steel',
  'aluminum',
  'oil',
  'energy',
  'electronics',
  'food',
  'rare',
] as const;

export type TradeResource = (typeof TRADE_RESOURCES)[number];

export type TradeRouteKind = 'land' | 'sea';

export interface TradeRoute {
  id: string;
  sellerId: string;
  buyerId: string;
  resource: TradeResource;
  /** Contracted daily units. */
  amount: number;
  kind: TradeRouteKind;
  sellerRegionId: string;
  buyerRegionId: string;
  /** Route multiplier from ports, roads and logistics. */
  capacity: number;
  /** Smoothed 0..1 share of the contracted amount actually moving. */
  throughput: number;
  /** 0..1 accumulated war, blockade, sanction and infrastructure disruption. */
  disruption: number;
  /** A supply contract pays a premium and is prioritised during shortages. */
  contract: boolean;
  active: boolean;
  createdDay: number;
  lastDeliveryDay: number;
}

export interface CountryTradeState {
  /** TradeRoute ids where this country is the buyer or seller. */
  routes: string[];
  agreements: string[];
  imports: Partial<Record<TradeResource, number>>;
  exports: Partial<Record<TradeResource, number>>;
  income: number;
  expenses: number;
  disruption: number;
  shortages: TradeResource[];
  surpluses: TradeResource[];
  lastUpdateDay: number;
}

export interface MarketState {
  prices: Record<TradeResource, number>;
  supply: Record<TradeResource, number>;
  demand: Record<TradeResource, number>;
  volume: number;
  lastUpdateDay: number;
}

export const MARKET_BASE_PRICES: Record<TradeResource, number> = {
  steel: 12,
  aluminum: 19,
  oil: 24,
  energy: 8,
  electronics: 38,
  food: 6,
  rare: 58,
};

export const createTradeState = (): CountryTradeState => ({
  routes: [],
  agreements: [],
  imports: {},
  exports: {},
  income: 0,
  expenses: 0,
  disruption: 0,
  shortages: [],
  surpluses: [],
  lastUpdateDay: 0,
});

export const createMarketState = (): MarketState => ({
  prices: { ...MARKET_BASE_PRICES },
  supply: { steel: 1, aluminum: 1, oil: 1, energy: 1, electronics: 1, food: 1, rare: 1 },
  demand: { steel: 1, aluminum: 1, oil: 1, energy: 1, electronics: 1, food: 1, rare: 1 },
  volume: 0,
  lastUpdateDay: 0,
});

export type TradeFailure =
  | 'unknown-country'
  | 'self'
  | 'no-agreement'
  | 'at-war'
  | 'embargoed'
  | 'sanctioned'
  | 'no-route'
  | 'invalid-resource'
  | 'insufficient-stock'
  | 'route-limit';

export type TradeResult = { ok: true; route: TradeRoute } | { ok: false; reason: TradeFailure };
