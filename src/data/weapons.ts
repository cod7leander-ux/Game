import type { LocalizedText } from '../i18n/types';
import type { WeaponDefinition, WeaponKind } from '../gameplay/tactical/types';

/**
 * Weapon catalogue.
 *
 * One resolver drives every weapon: the fields below decide behaviour, so
 * machine guns, tank cannons, artillery, missiles and future naval or
 * anti-air systems never get bespoke combat code. Adding a weapon is an entry
 * here plus a weapon id on a unit's tactical profile.
 */

interface WeaponSpec {
  id: string;
  name: LocalizedText;
  kind: WeaponKind;
  damage: number;
  range: number;
  accuracy: number;
  cooldown: number;
  projectileSpeed: number;
  targetLayers: Array<'ground' | 'air'>;
  armorPierce: number;
  splashRadius?: number;
  ammo?: number;
  burst?: number;
}

const defineWeapon = (spec: WeaponSpec): WeaponDefinition => ({
  id: spec.id,
  name: spec.name,
  kind: spec.kind,
  damage: spec.damage,
  range: spec.range,
  accuracy: spec.accuracy,
  cooldown: spec.cooldown,
  projectileSpeed: spec.projectileSpeed,
  targetLayers: spec.targetLayers,
  armorPierce: spec.armorPierce,
  splashRadius: spec.splashRadius ?? 0,
  ammo: spec.ammo ?? 0,
  burst: spec.burst ?? 1,
});

const WEAPON_SPECS: WeaponSpec[] = [
  {
    id: 'w_rifle',
    name: { en: 'Assault rifle', fa: 'تفنگ تهاجمی' },
    kind: 'bullet',
    damage: 9,
    range: 170,
    accuracy: 0.52,
    cooldown: 1.1,
    projectileSpeed: 900,
    targetLayers: ['ground'],
    armorPierce: 0.2,
    ammo: 0,
  },
  {
    id: 'w_mg',
    name: { en: 'Heavy machine gun', fa: 'مسلسل سنگین' },
    kind: 'bullet',
    damage: 7,
    range: 240,
    accuracy: 0.48,
    cooldown: 0.45,
    projectileSpeed: 880,
    targetLayers: ['ground', 'air'],
    armorPierce: 0.25,
    ammo: 0,
  },
  {
    id: 'w_tank_cannon',
    name: { en: '120 mm cannon', fa: 'توپ ۱۲۰ میلی‌متری' },
    kind: 'cannon',
    damage: 128,
    range: 640,
    accuracy: 0.66,
    cooldown: 6.2,
    projectileSpeed: 1500,
    targetLayers: ['ground'],
    armorPierce: 0.72,
    ammo: 0,
  },
  {
    id: 'w_autocannon',
    name: { en: 'Autocannon', fa: 'توپ خودکار' },
    kind: 'cannon',
    damage: 34,
    range: 420,
    accuracy: 0.6,
    cooldown: 1.6,
    projectileSpeed: 1200,
    targetLayers: ['ground', 'air'],
    armorPierce: 0.4,
    ammo: 0,
  },
  {
    id: 'w_artillery',
    name: { en: '155 mm howitzer', fa: 'هویتزر ۱۵۵ میلی‌متری' },
    kind: 'shell',
    damage: 170,
    range: 2600,
    accuracy: 0.46,
    cooldown: 13,
    projectileSpeed: 420,
    targetLayers: ['ground'],
    armorPierce: 0.65,
    splashRadius: 150,
    ammo: 0,
  },
  {
    id: 'w_rocket_artillery',
    name: { en: 'Rocket barrage', fa: 'رگبار راکتی' },
    kind: 'rocket',
    damage: 92,
    range: 3200,
    accuracy: 0.4,
    cooldown: 18,
    projectileSpeed: 520,
    targetLayers: ['ground'],
    armorPierce: 0.55,
    splashRadius: 190,
    burst: 3,
    ammo: 0,
  },
  {
    id: 'w_sam',
    name: { en: 'Surface-to-air missile', fa: 'موشک زمین‌به‌هوا' },
    kind: 'missile',
    damage: 150,
    range: 4200,
    accuracy: 0.74,
    cooldown: 11,
    projectileSpeed: 780,
    targetLayers: ['air'],
    armorPierce: 0.55,
    splashRadius: 60,
    ammo: 0,
  },
  {
    id: 'w_heli_rocket',
    name: { en: 'Rocket pod', fa: 'غلاف راکت' },
    kind: 'rocket',
    damage: 76,
    range: 950,
    accuracy: 0.55,
    cooldown: 7.5,
    projectileSpeed: 460,
    targetLayers: ['ground'],
    armorPierce: 0.62,
    splashRadius: 80,
    burst: 2,
    ammo: 0,
  },
  {
    id: 'w_heli_cannon',
    name: { en: 'Helicopter cannon', fa: 'توپ بالگرد' },
    kind: 'cannon',
    damage: 30,
    range: 520,
    accuracy: 0.58,
    cooldown: 1.4,
    projectileSpeed: 1050,
    targetLayers: ['ground', 'air'],
    armorPierce: 0.45,
    ammo: 0,
  },
  {
    id: 'w_air_air',
    name: { en: 'Air-to-air missile', fa: 'موشک هوا‌به‌هوا' },
    kind: 'missile',
    damage: 135,
    range: 1500,
    accuracy: 0.7,
    cooldown: 8.5,
    projectileSpeed: 900,
    targetLayers: ['air'],
    armorPierce: 0.6,
    splashRadius: 40,
    ammo: 0,
  },
  {
    id: 'w_air_ground',
    name: { en: 'Air-to-ground missile', fa: 'موشک هوا‌به‌زمین' },
    kind: 'missile',
    damage: 155,
    range: 1100,
    accuracy: 0.62,
    cooldown: 10,
    projectileSpeed: 700,
    targetLayers: ['ground'],
    armorPierce: 0.78,
    splashRadius: 90,
    ammo: 0,
  },
  {
    id: 'w_naval_gun',
    name: { en: 'Naval gun', fa: 'توپ دریایی' },
    kind: 'shell',
    damage: 140,
    range: 3000,
    accuracy: 0.5,
    cooldown: 8,
    projectileSpeed: 700,
    targetLayers: ['ground', 'air'],
    armorPierce: 0.6,
    splashRadius: 110,
    ammo: 0,
  },
  {
    id: 'w_cruise',
    name: { en: 'Cruise missile', fa: 'موشک کروز' },
    kind: 'missile',
    damage: 260,
    range: 6000,
    accuracy: 0.78,
    cooldown: 22,
    projectileSpeed: 620,
    targetLayers: ['ground'],
    armorPierce: 0.85,
    splashRadius: 130,
    ammo: 0,
  },
];

export const WEAPONS: Record<string, WeaponDefinition> = Object.fromEntries(
  WEAPON_SPECS.map((spec) => [spec.id, defineWeapon(spec)]),
);

export const getWeapon = (id: string): WeaponDefinition | undefined => WEAPONS[id];

export const WEAPON_LIST: WeaponDefinition[] = Object.values(WEAPONS);
