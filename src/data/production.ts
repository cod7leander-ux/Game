import type { InfrastructureProject } from '../gameplay/production/types';

/**
 * Infrastructure projects.
 *
 * These are the civilian use of industrial capacity: each one raises a region's
 * infrastructure, supply capacity or resource output. Costs and effects are
 * data, so new projects never need code, and the AI/player share the same
 * `ProductionSystem` path.
 */
export const INFRASTRUCTURE_PROJECTS: InfrastructureProject[] = [
  {
    id: 'proj_roads',
    name: { en: 'Road Network', fa: 'شبکه جاده‌ای' },
    description: {
      en: 'Paved corridors cut march times and push supply deeper into the country.',
      fa: 'کریدورهای آسفالت‌شده زمان حرکت را کاهش و تدارکات را عمیق‌تر می‌کنند.',
    },
    category: 'infrastructure',
    cost: { money: 90, steel: 40, oil: 6 },
    days: 24,
    effects: { infrastructure: 0.12, supply: 0.06 },
    requiresTech: [],
  },
  {
    id: 'proj_rail',
    name: { en: 'Rail Corridor', fa: 'کریدور ریلی' },
    description: {
      en: 'Heavy rail links the interior to the ports and the front.',
      fa: 'راه‌آهن سنگین، داخلی را به بندرها و جبهه پیوند می‌دهد.',
    },
    category: 'infrastructure',
    cost: { money: 220, steel: 120, oil: 14, electronics: 10 },
    days: 55,
    effects: { infrastructure: 0.2, supply: 0.12, industry: 0.04 },
    requiresTech: ['log_rail'],
    requiresInfrastructure: 0.35,
  },
  {
    id: 'proj_power',
    name: { en: 'Power Station', fa: 'نیروگاه' },
    description: {
      en: 'Generating capacity for factories, radar and research campuses.',
      fa: 'ظرفیت تولید برق برای کارخانه‌ها، رادار و مراکز پژوهشی.',
    },
    category: 'infrastructure',
    cost: { money: 150, steel: 70, oil: 10, electronics: 18 },
    days: 38,
    effects: { infrastructure: 0.1, industry: 0.08, resource: { energy: 0.8 } },
    requiresTech: ['nrg_grid'],
  },
  {
    id: 'proj_port',
    name: { en: 'Port Expansion', fa: 'توسعه بندر' },
    description: {
      en: 'Deep-water berths and cranes raise coastal supply and trade throughput.',
      fa: 'اسکله‌های آب‌عمیق و جرثقیل‌ها تدارکات ساحلی و تجارت را افزایش می‌دهند.',
    },
    category: 'infrastructure',
    cost: { money: 180, steel: 90, oil: 12, electronics: 14 },
    days: 42,
    effects: { infrastructure: 0.14, supply: 0.16, portCapacity: 0.25, resource: { food: 0.3 } },
    requiresTech: ['nav_hull'],
  },
  {
    id: 'proj_airbase',
    name: { en: 'Air Base', fa: 'پایگاه هوایی' },
    description: {
      en: 'Hardened runways and maintenance halls support sustained air operations.',
      fa: 'باندهای مقاوم و آشیانه‌های نگهداری، عملیات هوایی پایدار را پشتیبانی می‌کنند.',
    },
    category: 'infrastructure',
    cost: { money: 210, steel: 80, oil: 18, electronics: 30 },
    days: 46,
    effects: { infrastructure: 0.1, supply: 0.08, airportCapacity: 0.3 },
    requiresTech: ['air_jet'],
  },
  {
    id: 'proj_depot',
    name: { en: 'Supply Depot', fa: 'انبار تدارکات' },
    description: {
      en: 'Prepositioned fuel, ammunition and spares keep armies in the field.',
      fa: 'سوخت، مهمات و قطعات پیش‌استقرار، ارتش‌ها را در میدان نگه می‌دارد.',
    },
    category: 'infrastructure',
    cost: { money: 70, steel: 30, oil: 8, electronics: 4 },
    days: 20,
    effects: { supply: 0.2, stability: 0.004 },
    requiresTech: ['log_supply'],
  },
  {
    id: 'proj_industry',
    name: { en: 'Industrial Zone', fa: 'منطقه صنعتی' },
    description: {
      en: 'Clustered factories and suppliers raise regional industrial output.',
      fa: 'کارخانه‌ها و تأمین‌کنندگان خوشه‌ای، تولید صنعتی منطقه را بالا می‌برند.',
    },
    category: 'infrastructure',
    cost: { money: 260, steel: 140, oil: 20, electronics: 24 },
    days: 60,
    effects: {
      infrastructure: 0.08,
      industry: 0.12,
      civilianIndustry: 0.1,
      militaryIndustry: 0.06,
      resource: { steel: 0.6 },
    },
    requiresTech: ['ind_assembly'],
    requiresInfrastructure: 0.4,
  },
  {
    id: 'proj_military_factory',
    name: { en: 'Military Factory', fa: 'کارخانه نظامی' },
    description: {
      en: 'Armament lines and assembly halls expand military industry and strategic-weapons capacity.',
      fa: 'خطوط تسلیحاتی و سالن‌های مونتاژ، صنعت نظامی و ظرفیت سلاح‌های راهبردی را گسترش می‌دهند.',
    },
    category: 'infrastructure',
    cost: { money: 240, steel: 130, oil: 16, electronics: 22, rare: 4 },
    days: 50,
    effects: { militaryIndustry: 0.16, industry: 0.06, resource: { steel: 0.45 } },
    requiresTech: ['ind_assembly'],
    requiresInfrastructure: 0.35,
  },
  {
    id: 'proj_civil_works',
    name: { en: 'Civil Works Programme', fa: 'برنامه عمران شهری' },
    description: {
      en: 'Housing, water and commercial districts raise civilian industry and population capacity.',
      fa: 'مسکن، آب و نواحی تجاری صنعت غیرنظامی و ظرفیت جمعیت را بالا می‌برند.',
    },
    category: 'infrastructure',
    cost: { money: 190, steel: 90, oil: 8, electronics: 6 },
    days: 36,
    effects: { civilianIndustry: 0.14, constructionCapacity: 0.08, populationCapacity: 0.18, stability: 0.004 },
    requiresTech: [],
    requiresInfrastructure: 0.2,
  },
  {
    id: 'proj_radar',
    name: { en: 'Radar Station', fa: 'پایگاه راداری' },
    description: {
      en: 'Air-search radar and signals interceptors extend detection and air-defence coverage.',
      fa: 'رادار جست‌وجوی هوایی و شنود، پوشش تشخیص و پدافند هوایی را گسترش می‌دهد.',
    },
    category: 'infrastructure',
    cost: { money: 140, steel: 45, electronics: 40, oil: 4 },
    days: 28,
    effects: { radar: 0.28, airportCapacity: 0.04 },
    requiresTech: [],
  },
  {
    id: 'proj_fortress',
    name: { en: 'Fortified District', fa: 'منطقه استحکام‌شده' },
    description: {
      en: 'Concrete works, minefields and local command posts make a landing or breakthrough costly.',
      fa: 'سازه‌های بتنی، میدان‌های مین و مقرهای محلی، پیاده‌سازی یا شکستن جبهه را پرهزینه می‌کنند.',
    },
    category: 'infrastructure',
    cost: { money: 160, steel: 120, oil: 6, electronics: 10 },
    days: 34,
    effects: { fortification: 0.2, supply: 0.05, stability: 0.003 },
    requiresTech: [],
  },
  {
    id: 'proj_fortify',
    name: { en: 'Border Fortifications', fa: 'استحکامات مرزی' },
    description: {
      en: 'Bunkers, obstacles and radar posts make the region costly to take.',
      fa: 'سنگرها، موانع و پایگاه‌های راداری، تصرف منطقه را پرهزینه می‌کنند.',
    },
    category: 'infrastructure',
    cost: { money: 120, steel: 100, oil: 6, electronics: 8 },
    days: 30,
    effects: { infrastructure: 0.06, supply: 0.04, stability: 0.006 },
    requiresTech: [],
  },
];

export const PROJECT_BY_ID: Record<string, InfrastructureProject> = Object.fromEntries(
  INFRASTRUCTURE_PROJECTS.map((project) => [project.id, project]),
);

export const getProject = (id: string): InfrastructureProject | undefined => PROJECT_BY_ID[id];
