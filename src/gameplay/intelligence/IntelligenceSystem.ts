import { clamp01 } from '../../core/math';
import { getUnit } from '../../data/units';
import type { CountryState } from '../country/types';
import { areAllied, areAtWar } from '../diplomacy/helpers';
import type { SimEventSink } from '../events';
import { armyUnits } from '../military/armies';
import type { World } from '../World';
import { createIntelligenceState, type IntelligenceContact } from './types';

/**
 * Strategic intelligence.
 *
 * Detection is derived from reconnaissance formations, radar infrastructure,
 * technology, policy and allied information sharing. Contacts decay when a
 * country stops observing a region, so intelligence is useful but perishable.
 * Basic world information (ownership, cities, diplomacy) is never hidden.
 */
const CONTACT_DECAY = 0.035;

const airDetection = (country: CountryState): number => {
  let detection = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (!unit) continue;
    if (unit.role === 'recon' || unit.role === 'electronicWarfare') {
      detection += count * (unit.stats.detection / 900);
    }
  }
  return detection;
};

const navalDetection = (country: CountryState): number => {
  let detection = 0;
  for (const [unitId, count] of Object.entries(country.military.formations)) {
    const unit = getUnit(unitId);
    if (unit?.domain === 'naval') detection += count * (unit.stats.detection / 2200);
  }
  return detection;
};

export class IntelligenceSystem {
  constructor(_events: SimEventSink) {}

  tick(world: World, country: CountryState, day: number): void {
    const intel = country.intelligence;
    if (!intel) {
      country.intelligence = createIntelligenceState();
      return;
    }
    const radar = country.regions.reduce((sum, region) => sum + (region.radar ?? 0), 0) /
      Math.max(1, country.regions.length);
    const recon = airDetection(country);
    const naval = navalDetection(country);
    const policy = country.policy?.active.includes('pol_security_state') ? 0.12 : 0;
    const corps = country.policy?.active.includes('pol_diplomatic_corps') ? 0.06 : 0;
    const reconMission = (country.warfare?.air.missions ?? []).some(
      (mission) => mission.type === 'recon' && mission.status === 'active',
    )
      ? 0.15
      : 0;
    const detection = clamp01(
      0.18 + recon + naval + radar * 0.5 + (country.modifiers?.detection ?? 0) + policy + corps + reconMission,
    );
    intel.detection = detection;
    intel.radarCoverage = clamp01(radar);
    intel.coverage = clamp01(0.2 + recon * 0.8 + radar * 0.45 + naval * 0.3);
    intel.lastUpdateDay = day;

    const observe = new Set<string>();
    for (const id of world.neighboursOf(country.id)) observe.add(id);
    for (const id of country.diplomacy.wars) observe.add(id);
    for (const id of country.diplomacy.allies) observe.add(id);
    for (const front of Object.values(world.frontlines)) {
      if (front.attackerId === country.id) observe.add(front.defenderId);
      if (front.defenderId === country.id) observe.add(front.attackerId);
    }

    let confidenceSum = 0;
    for (const otherId of observe) {
      const other = world.get(otherId);
      if (!other) continue;
      const allied = areAllied(country, other);
      const atWar = areAtWar(country, other);
      const proximity = world.neighboursOf(country.id).includes(otherId) ? 1 : 0.62;
      const sharing = allied ? 0.28 : 0;
      const signals = (country.diplomacy.relations[otherId]?.trust ?? 0) / 700;
      const rawConfidence = clamp01(
        detection * proximity * 0.78 + sharing + signals + (atWar ? 0.1 : 0),
      );
      const source: IntelligenceContact['source'] = allied
        ? 'diplomacy'
        : radar > 0.15
          ? 'radar'
          : recon > 0
            ? 'recon'
            : 'signals';
      const existing = intel.contacts[otherId];
      const decayed = existing
        ? Math.max(0, existing.confidence - CONTACT_DECAY * (1 - sharing))
        : 0;
      const confidence = Math.max(rawConfidence, decayed);
      const formations = other.military.armies.reduce((sum, army) => sum + armyUnits(army), 0);
      const noise = confidence < 0.4 ? 0.65 + (1 - confidence) * 0.55 : 0.9 + confidence * 0.12;
      intel.contacts[otherId] = {
        countryId: otherId,
        lastSeenDay: rawConfidence > 0.12 ? day : (existing?.lastSeenDay ?? day),
        confidence,
        estimatedArmyStrength: Math.round(other.military.strengthIndex * noise),
        estimatedNavalStrength: Math.round(
          other.military.armies.reduce(
            (sum, army) =>
              sum +
              Object.entries(army.composition).reduce((unitSum, [unitId, count]) => {
                const unit = getUnit(unitId);
                return unit?.domain === 'naval' ? unitSum + count : unitSum;
              }, 0),
            0,
          ) * noise,
        ),
        estimatedAirStrength: Math.round(
          other.military.armies.reduce(
            (sum, army) =>
              sum +
              Object.entries(army.composition).reduce((unitSum, [unitId, count]) => {
                const unit = getUnit(unitId);
                return unit?.domain === 'air' ? unitSum + count : unitSum;
              }, 0),
            0,
          ) * noise,
        ),
        detectedFormations: Math.round(formations * confidence),
        source,
      };
      confidenceSum += confidence;
    }

    // Contacts that can no longer be observed decay away, but remain visible as
    // stale intelligence for a while rather than disappearing abruptly.
    for (const [id, contact] of Object.entries(intel.contacts)) {
      if (observe.has(id)) continue;
      contact.confidence = Math.max(0, contact.confidence - CONTACT_DECAY * 1.4);
      if (contact.confidence <= 0.01) delete intel.contacts[id];
    }
    intel.confidence = Object.keys(intel.contacts).length > 0
      ? confidenceSum / Object.keys(intel.contacts).length
      : 0.15;
  }

  /** A reconnaissance mission reveals a specific country immediately. */
  reveal(country: CountryState, targetId: string, day: number): void {
    const contact = country.intelligence.contacts[targetId];
    if (contact) {
      contact.confidence = Math.min(1, contact.confidence + 0.25);
      contact.lastSeenDay = day;
    }
  }
}
