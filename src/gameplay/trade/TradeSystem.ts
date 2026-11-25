import { clamp, clamp01 } from '../../core/math';
import { regionAt } from '../../data/regions';
import { hashString } from '../../core/math';
import type { ResourceId } from '../economy/types';
import type { CountryState } from '../country/types';
import type { SimEventSink } from '../events';
import type { RegionState } from '../regions/types';
import type { World } from '../World';
import {
  MARKET_BASE_PRICES,
  TRADE_RESOURCES,
  createTradeState,
  type CountryTradeState,
  type TradeResource,
  type TradeFailure,
  type TradeResult,
  type TradeRoute,
} from './types';

/**
 * Trade, market pricing and convoy capacity.
 *
 * Trade is not a separate economy: routes move real resources between the same
 * stockpiles the economy and military use. Throughput depends on ports, roads,
 * logistics capacity, blockade, sanctions and war, and every transfer costs
 * real credits. Prices emerge from aggregate supply and demand and move slowly.
 */

const MAX_ROUTES_PER_COUNTRY = 8;
const PRICE_UPDATE_DAYS = 7;
const AI_TRADE_DAYS = 11;

export const isTradeResource = (value: string): value is TradeResource =>
  (TRADE_RESOURCES as readonly string[]).includes(value);

const hasPort = (country: CountryState): boolean =>
  country.regions.some((region) => regionAt(region.id)?.hasPort);

const bestPort = (country: CountryState): RegionState | undefined =>
  country.regions
    .filter((region) => regionAt(region.id)?.hasPort)
    .sort((a, b) => (b.portCapacity ?? 0) - (a.portCapacity ?? 0))[0];

const tradeRegion = (country: CountryState, resource: TradeResource): RegionState => {
  const producer = country.regions
    .slice()
    .sort((a, b) => {
      const richness = (region: RegionState): number =>
        regionAt(region.id)?.richness[resource] ?? 0;
      return richness(b) - richness(a);
    })[0];
  return producer ?? country.regions[0];
};

const routeCapacity = (world: World, kind: 'land' | 'sea', seller: CountryState, buyer: CountryState): number => {
  if (kind === 'sea') {
    const sellerPort = bestPort(seller);
    const buyerPort = bestPort(buyer);
    if (!sellerPort || !buyerPort) return 0;
    const port = Math.min(sellerPort.portCapacity ?? 0.4, buyerPort.portCapacity ?? 0.4);
    const routes = (seller.logisticsState?.throughput ?? 0.5) * 0.4 + (buyer.logisticsState?.throughput ?? 0.5) * 0.4;
    return clamp(0.25 + port * 0.55 + routes * 0.5, 0.2, 1.35);
  }
  const sellerInfra = seller.regions.reduce((sum, region) => sum + region.infrastructure, 0) / Math.max(1, seller.regions.length);
  const buyerInfra = buyer.regions.reduce((sum, region) => sum + region.infrastructure, 0) / Math.max(1, buyer.regions.length);
  const adjacent = world.neighboursOf(seller.id).includes(buyer.id);
  return clamp(0.2 + (sellerInfra + buyerInfra) * 0.35 + (adjacent ? 0.25 : 0), 0.15, 1.2);
};

const relationAllowsTrade = (
  seller: CountryState,
  buyer: CountryState,
): { ok: true } | { ok: false; reason: TradeFailure } => {
  const relation = seller.diplomacy.relations[buyer.id];
  if (seller.diplomacy.wars.includes(buyer.id) || buyer.diplomacy.wars.includes(seller.id)) {
    return { ok: false, reason: 'at-war' };
  }
  if (seller.diplomacy.embargoed.includes(buyer.id)) return { ok: false, reason: 'embargoed' };
  if (relation?.sanctioned) return { ok: false, reason: 'sanctioned' };
  if (!seller.diplomacy.tradePartners.includes(buyer.id)) return { ok: false, reason: 'no-agreement' };
  return { ok: true };
};

const ensureTrade = (country: CountryState): CountryTradeState => {
  if (!country.trade) country.trade = createTradeState();
  return country.trade;
};

export class TradeSystem {
  constructor(private readonly events: SimEventSink) {}

  ensureWorld(world: World): void {
    if (!world.market) world.market = {
      prices: { ...MARKET_BASE_PRICES },
      supply: { steel: 1, aluminum: 1, oil: 1, energy: 1, electronics: 1, food: 1, rare: 1 },
      demand: { steel: 1, aluminum: 1, oil: 1, energy: 1, electronics: 1, food: 1, rare: 1 },
      volume: 0,
      lastUpdateDay: 0,
    };
    for (const country of world.countries.values()) ensureTrade(country);
  }

  createRoute(
    world: World,
    sellerId: string,
    buyerId: string,
    resource: string,
    amount: number,
    day: number,
    contract = false,
  ): TradeResult {
    this.ensureWorld(world);
    const seller = world.get(sellerId);
    const buyer = world.get(buyerId);
    if (!seller || !buyer) return { ok: false, reason: 'unknown-country' };
    if (sellerId === buyerId) return { ok: false, reason: 'self' };
    if (!isTradeResource(resource)) return { ok: false, reason: 'invalid-resource' };
    const permission = relationAllowsTrade(seller, buyer);
    if (!permission.ok) return { ok: false, reason: permission.reason ?? 'no-agreement' };
    if (ensureTrade(seller).routes.length >= MAX_ROUTES_PER_COUNTRY || ensureTrade(buyer).routes.length >= MAX_ROUTES_PER_COUNTRY) {
      return { ok: false, reason: 'route-limit' };
    }
    if (seller.economy.resources[resource as ResourceId] <= 1 && (seller.economy.resourceFlow[resource as ResourceId] ?? 0) <= 0) {
      return { ok: false, reason: 'insufficient-stock' };
    }
    const sellerRegion = tradeRegion(seller, resource);
    const buyerRegion = buyer.capitalRegionId
      ? (buyer.regions.find((region) => region.id === buyer.capitalRegionId) ?? buyer.regions[0])
      : buyer.regions[0];
    if (!sellerRegion || !buyerRegion) return { ok: false, reason: 'no-route' };
    const kind = world.neighboursOf(sellerId).includes(buyerId) ? 'land' : 'sea';
    if (kind === 'sea' && (!hasPort(seller) || !hasPort(buyer))) {
      return { ok: false, reason: 'no-route' };
    }
    const capacity = routeCapacity(world, kind, seller, buyer);
    if (capacity <= 0) return { ok: false, reason: 'no-route' };
    const route: TradeRoute = {
      id: `TR-${sellerId}-${buyerId}-${resource}-${day}-${Object.keys(world.tradeRoutes).length}`,
      sellerId,
      buyerId,
      resource,
      amount: clamp(amount, 0.1, 30),
      kind,
      sellerRegionId: sellerRegion.id,
      buyerRegionId: buyerRegion.id,
      capacity,
      throughput: 0.2,
      disruption: 0,
      contract,
      active: true,
      createdDay: day,
      lastDeliveryDay: 0,
    };
    world.tradeRoutes[route.id] = route;
    ensureTrade(seller).routes.push(route.id);
    ensureTrade(buyer).routes.push(route.id);
    if (!seller.diplomacy.tradePartners.includes(buyerId)) seller.diplomacy.tradePartners.push(buyerId);
    if (!buyer.diplomacy.tradePartners.includes(sellerId)) buyer.diplomacy.tradePartners.push(sellerId);
    this.events.emit({
      type: 'tradeRouteOpened',
      countryId: sellerId,
      partnerId: buyerId,
      routeId: route.id,
      day,
    });
    return { ok: true, route };
  }

  cancelRoute(world: World, countryId: string, routeId: string, day: number): boolean {
    const route = world.tradeRoutes[routeId];
    if (!route || (route.sellerId !== countryId && route.buyerId !== countryId)) return false;
    route.active = false;
    for (const id of [route.sellerId, route.buyerId]) {
      const state = world.get(id)?.trade;
      if (state) state.routes = state.routes.filter((entry) => entry !== routeId);
    }
    delete world.tradeRoutes[routeId];
    this.events.emit({ type: 'tradeRouteClosed', countryId, routeId, day });
    return true;
  }

  tick(world: World, day: number): void {
    this.ensureWorld(world);
    if (day % PRICE_UPDATE_DAYS === 0) this.updatePrices(world, day);
    let volume = 0;
    for (const country of world.countries.values()) {
      const state = ensureTrade(country);
      state.income = 0;
      state.expenses = 0;
      state.imports = {};
      state.exports = {};
    }

    for (const route of Object.values(world.tradeRoutes)) {
      const seller = world.get(route.sellerId);
      const buyer = world.get(route.buyerId);
      if (!seller || !buyer) {
        route.active = false;
        continue;
      }
      const permission = relationAllowsTrade(seller, buyer);
      const sellerState = ensureTrade(seller);
      const buyerState = ensureTrade(buyer);
      const resource = route.resource as ResourceId;
      if (!permission.ok) {
        route.disruption = clamp01(route.disruption + 0.08);
        route.active = false;
        continue;
      }
      route.active = true;

      const blocked = Math.max(
        seller.warfare?.naval.blockadeEffect ?? 0,
        buyer.warfare?.naval.blockadeEffect ?? 0,
      );
      const sellerLogistics = seller.logisticsState?.throughput ?? 0.55;
      const buyerLogistics = buyer.logisticsState?.throughput ?? 0.55;
      const logisticsFactor = 0.55 + (sellerLogistics + buyerLogistics) * 0.25;
      const warFactor = seller.diplomacy.wars.length > 0 || buyer.diplomacy.wars.length > 0 ? 0.85 : 1;
      const targetThroughput = clamp01(
        route.capacity * logisticsFactor * warFactor * (1 - blocked * 0.65) * (1 - route.disruption * 0.7),
      );
      route.throughput += (targetThroughput - route.throughput) * 0.16;
      route.disruption = clamp01(route.disruption - 0.012 + blocked * 0.015);

      const stock = seller.economy.resources[resource];
      const available = Math.max(0, stock - 0.5);
      if (available <= 0.01) {
        route.disruption = clamp01(route.disruption + 0.04);
        continue;
      }
      const price = world.market.prices[route.resource] * (route.contract ? 1.18 : 1);
      const desired = Math.min(route.amount, available, route.amount * route.throughput);
      const affordable = buyer.economy.resources.money / Math.max(0.01, price);
      const delivered = Math.max(0, Math.min(desired, affordable));
      if (delivered <= 0.001) continue;
      seller.economy.resources[resource] -= delivered;
      buyer.economy.resources[resource] += delivered;
      const value = delivered * price;
      buyer.economy.resources.money -= value;
      seller.economy.resources.money += value;
      sellerState.exports[route.resource] = (sellerState.exports[route.resource] ?? 0) + delivered;
      buyerState.imports[route.resource] = (buyerState.imports[route.resource] ?? 0) + delivered;
      sellerState.income += value;
      buyerState.expenses += value;
      route.lastDeliveryDay = day;
      volume += value;
      if (route.throughput < 0.35 && day % 20 === 0) {
        this.events.emit({
          type: 'tradeDisrupted',
          countryId: buyer.id,
          routeId: route.id,
          severity: route.throughput < 0.15 ? 'severe' : 'partial',
          day,
        });
      }
    }

    world.market.volume = volume;
    world.market.lastUpdateDay = day;
    for (const country of world.countries.values()) {
      this.updateCountryState(world, country, day);
    }
    if (day % AI_TRADE_DAYS === 0) this.aiConsider(world, day);
  }

  private updateCountryState(world: World, country: CountryState, day: number): void {
    const state = ensureTrade(country);
    const routeList = state.routes
      .map((id) => world.tradeRoutes[id])
      .filter((route): route is TradeRoute => Boolean(route));
    state.disruption = routeList.length > 0
      ? routeList.reduce((sum, route) => sum + route.disruption, 0) / routeList.length
      : 0;
    state.shortages = TRADE_RESOURCES.filter((resource) => {
      const flow = country.economy.resourceFlow[resource as ResourceId] ?? 0;
      return flow < -0.05 && country.economy.resources[resource as ResourceId] < 10;
    });
    state.surpluses = TRADE_RESOURCES.filter((resource) => {
      const flow = country.economy.resourceFlow[resource as ResourceId] ?? 0;
      return flow > 0.2 && country.economy.resources[resource as ResourceId] > 20;
    });
    state.lastUpdateDay = day;
  }

  private updatePrices(world: World, day: number): void {
    const supply = { ...world.market.supply };
    const demand = { ...world.market.demand };
    for (const resource of TRADE_RESOURCES) {
      supply[resource] = 0;
      demand[resource] = 0;
    }
    for (const country of world.countries.values()) {
      for (const resource of TRADE_RESOURCES) {
        const flow = country.economy.resourceFlow[resource as ResourceId] ?? 0;
        if (flow > 0) supply[resource] += flow;
        else demand[resource] += -flow;
        demand[resource] += country.population / 1_000_000_000 * (resource === 'food' ? 0.32 : 0.08);
      }
    }
    for (const resource of TRADE_RESOURCES) {
      const ratio = supply[resource] / Math.max(0.1, demand[resource]);
      const scarcity = clamp(1.35 - Math.min(1.2, ratio) * 0.55, 0.65, 1.8);
      const base = MARKET_BASE_PRICES[resource];
      const target = base * scarcity;
      world.market.prices[resource] = clamp(
        world.market.prices[resource] + (target - world.market.prices[resource]) * 0.25,
        base * 0.55,
        base * 2.4,
      );
    }
    world.market.supply = supply;
    world.market.demand = demand;
    world.market.lastUpdateDay = day;
  }

  /** Deterministic AI trade decisions over the same route API as the player. */
  private aiConsider(world: World, day: number): void {
    for (const country of world.countries.values()) {
      if (country.id === world.playerCountryId || country.occupierId) continue;
      if (day % 3 !== hashString(country.id) % 3) continue;
      const state = ensureTrade(country);
      if (state.routes.length >= 4) continue;
      if (country.economy.resources.money < Math.max(80, country.economy.gdp * 0.0004)) continue;
      const partnerId = country.diplomacy.tradePartners[0];
      if (!partnerId) continue;
      const partner = world.get(partnerId);
      if (!partner) continue;
      const resource = TRADE_RESOURCES
        .map((entry) => ({
          entry,
          exportable: partner.economy.resourceFlow[entry as ResourceId] ?? 0,
          needed: -(country.economy.resourceFlow[entry as ResourceId] ?? 0),
        }))
        .filter((entry) => entry.exportable > 0.1)
        .sort((a, b) => b.needed - a.needed || b.exportable - a.exportable)[0];
      if (!resource) continue;
      const amount = clamp(resource.exportable * 0.25, 0.2, 8);
      if (this.createRoute(world, partner.id, country.id, resource.entry, amount, day).ok) {
        this.events.emit({
          type: 'aiDecision',
          countryId: country.id,
          focus: 'trade',
          day,
        });
      }
    }
  }
}

