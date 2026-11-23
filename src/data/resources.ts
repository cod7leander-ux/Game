import type { ResourceDefinition, ResourceId } from '../gameplay/economy/types';

/** Strategic resources. Ordered as displayed in the economy panel. */
export const RESOURCES: Record<ResourceId, ResourceDefinition> = {
  money: {
    id: 'money',
    name: { en: 'Credits', fa: 'اعتبار' },
    short: { en: 'CR', fa: 'اعتبار' },
    color: '#e8b45a',
    description: {
      en: 'State treasury. Funds production, research and upkeep.',
      fa: 'خزانه دولت. هزینه تولید، پژوهش و نگهداری را تأمین می‌کند.',
    },
  },
  steel: {
    id: 'steel',
    name: { en: 'Steel', fa: 'فولاد' },
    short: { en: 'ST', fa: 'فولاد' },
    color: '#9fb4c7',
    description: {
      en: 'Rolled armour plate, structural beams and ship hulls.',
      fa: 'ورق زرهی، تیرهای سازه‌ای و بدنه کشتی‌ها.',
    },
  },
  aluminum: {
    id: 'aluminum',
    name: { en: 'Aluminium', fa: 'آلومینیوم' },
    short: { en: 'AL', fa: 'آلومینیوم' },
    color: '#c8d4dd',
    description: {
      en: 'Light alloys for airframes, missiles and drones.',
      fa: 'آلیاژهای سبک برای بدنه هواگردها، موشک‌ها و پهپادها.',
    },
  },
  oil: {
    id: 'oil',
    name: { en: 'Oil', fa: 'نفت' },
    short: { en: 'OL', fa: 'نفت' },
    color: '#8a6b4f',
    description: {
      en: 'Fuel for vehicles, aircraft and naval groups.',
      fa: 'سوخت خودروها، هواپیماها و گروه‌های دریایی.',
    },
  },
  energy: {
    id: 'energy',
    name: { en: 'Energy', fa: 'انرژی' },
    short: { en: 'EN', fa: 'انرژی' },
    color: '#7fd1c8',
    description: {
      en: 'Electrical output for industry, radar and research.',
      fa: 'توان برق برای صنعت، رادار و پژوهش.',
    },
  },
  electronics: {
    id: 'electronics',
    name: { en: 'Electronics', fa: 'الکترونیک' },
    short: { en: 'EL', fa: 'الکترونیک' },
    color: '#8fa8ff',
    description: {
      en: 'Sensors, guidance packages and command networks.',
      fa: 'حسگرها، سامانه‌های هدایت و شبکه‌های فرماندهی.',
    },
  },
  food: {
    id: 'food',
    name: { en: 'Food', fa: 'غذا' },
    short: { en: 'FD', fa: 'غذا' },
    color: '#a8c98a',
    description: {
      en: 'Agricultural surplus that keeps the population stable.',
      fa: 'مازاد کشاورزی که ثبات جمعیت را حفظ می‌کند.',
    },
  },
  rare: {
    id: 'rare',
    name: { en: 'Rare materials', fa: 'مواد کمیاب' },
    short: { en: 'RM', fa: 'کمیاب' },
    color: '#c99adf',
    description: {
      en: 'Strategic minerals for advanced airframes and missiles.',
      fa: 'مواد معدنی راهبردی برای هواگردهای پیشرفته و موشک‌ها.',
    },
  },
};

export const RESOURCE_ORDER: ResourceId[] = [
  'money',
  'steel',
  'aluminum',
  'oil',
  'energy',
  'electronics',
  'food',
  'rare',
];

export const resourceName = (id: ResourceId) => RESOURCES[id].name;
