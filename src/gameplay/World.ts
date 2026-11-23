import { hashString, wrapLongitude } from '../core/math';
import { Rng } from '../core/rng';
import {
  COUNTRY_DEFINITIONS,
  COUNTRY_BY_ID,
  MAX_BASE_GDP,
} from '../data/countries';
import { createRelation } from './diplomacy/types';
import { createCountryState } from './country/factory';
import { recomputeModifiers } from './country/modifiers';
import type { CountryDefinition, CountryState } from './country/types';

/**
 * Runtime container for every country in a campaign.
 *
 * Deliberately a Map of plain, serialisable state: the simulation mutates it in
 * place, saves snapshot it, and the renderer only reads the immutable
 * definitions. Scaling to thousands of regions happens by adding region states
 * keyed off the same country objects, not by changing this contract.
 */

export interface WorldInit {
  seed: number;
  playerCountryId: string;
  day: number;
}

export class World {
  readonly seed: number;
  readonly playerCountryId: string;
  day: number;
  readonly countries = new Map<string, CountryState>();
  private adjacency = new Map<string, string[]>();

  constructor(init: WorldInit, restored?: CountryState[]) {
    this.seed = init.seed >>> 0;
    this.playerCountryId = init.playerCountryId;
    this.day = init.day;
    if (restored && restored.length > 0) {
      for (const state of restored) this.countries.set(state.id, state);
      this.buildAdjacency();
    } else {
      this.populate();
    }
  }

  private populate(): void {
    const definitionByIso = COUNTRY_BY_ID;
    for (const definition of COUNTRY_DEFINITIONS) {
      if (!definitionByIso[definition.id]) continue;
      const state = createCountryState(definition, {
        day: this.day,
        seed: this.seed,
        isPlayer: definition.id === this.playerCountryId,
      });
      recomputeModifiers(state);
      this.countries.set(definition.id, state);
    }
    this.buildAdjacency();
    this.seedDiplomacy();
  }

  /**
   * Approximate adjacency from label proximity on the sphere.
   *
   * A precise border graph comes from the geometry pipeline later; proximity is
   * deterministic and adequate for diplomatic contact in Milestone 1.
   */
  private buildAdjacency(): void {
    const definitions = this.definitions();
    const pairs: Array<{ a: string; b: string; distance: number }> = [];

    for (let i = 0; i < definitions.length; i += 1) {
      const a = definitions[i];
      for (let j = i + 1; j < definitions.length; j += 1) {
        const b = definitions[j];
        const dLon = Math.abs(wrapLongitude(a.label[0] - b.label[0]));
        const dLat = Math.abs(a.label[1] - b.label[1]);
        // Scale the contact radius by the size of the smaller nation.
        const scale = a.baseGdp > MAX_BASE_GDP * 0.05 || b.baseGdp > MAX_BASE_GDP * 0.05 ? 1.5 : 1;
        const distance = Math.hypot(dLon, dLat * 1.35);
        if (distance < 19 * scale) pairs.push({ a: a.id, b: b.id, distance });
      }
    }

    pairs.sort((left, right) => left.distance - right.distance);
    for (const pair of pairs) {
      const listA = this.adjacency.get(pair.a) ?? [];
      if (listA.length < 8) {
        listA.push(pair.b);
        this.adjacency.set(pair.a, listA);
      }
      const listB = this.adjacency.get(pair.b) ?? [];
      if (listB.length < 8) {
        listB.push(pair.a);
        this.adjacency.set(pair.b, listB);
      }
    }
  }

  private seedDiplomacy(): void {
    const rng = new Rng((this.seed ^ 0x5f3759df) >>> 0);
    const day = this.day;

    for (const country of this.countries.values()) {
      const neighbours = this.neighboursOf(country.id);
      for (const neighbourId of neighbours) {
        if (country.diplomacy.relations[neighbourId]) continue;
        const value = rng.range(-18, 34);
        const relation = createRelation(day, value);
        relation.tradePartner = value > 20 && rng.chance(0.5);
        country.diplomacy.relations[neighbourId] = relation;
        if (relation.tradePartner) country.diplomacy.tradePartners.push(neighbourId);
      }
      // A handful of long-standing friendships become alliances.
      if (neighbours.length > 0 && rng.chance(0.12)) {
        const allyId = rng.pick(neighbours);
        const relation = country.diplomacy.relations[allyId];
        if (relation && relation.value > 15) {
          relation.ally = true;
          relation.value = Math.max(65, relation.value);
          if (!country.diplomacy.allies.includes(allyId)) country.diplomacy.allies.push(allyId);
          const reverse = this.countries.get(allyId)?.diplomacy.relations[country.id];
          if (reverse) {
            reverse.ally = true;
            reverse.value = Math.max(65, reverse.value);
            const ally = this.countries.get(allyId);
            if (ally && !ally.diplomacy.allies.includes(country.id)) {
              ally.diplomacy.allies.push(country.id);
            }
          }
        }
      }
    }
  }

  definitions(): CountryDefinition[] {
    return COUNTRY_DEFINITIONS.filter((definition) => this.countries.has(definition.id));
  }

  get(id: string): CountryState | undefined {
    return this.countries.get(id);
  }

  get player(): CountryState | undefined {
    return this.countries.get(this.playerCountryId);
  }

  neighboursOf(id: string): string[] {
    return this.adjacency.get(id) ?? [];
  }

  /** Largest economies first; used by AI scoring and the diplomacy list. */
  rankedByStrength(): CountryState[] {
    return [...this.countries.values()].sort(
      (a, b) => b.military.strengthIndex - a.military.strengthIndex,
    );
  }

  totalStrength(): number {
    let total = 0;
    for (const country of this.countries.values()) total += country.military.strengthIndex;
    return total;
  }

  /** Deterministic per-country random stream so systems never share RNG state. */
  rngFor(countryId: string, salt = 0): Rng {
    return new Rng((hashString(countryId) ^ this.seed ^ (salt * 2654435761)) >>> 0);
  }
}
