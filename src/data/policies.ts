import type { PolicyDefinition } from '../gameplay/policy/types';

/**
 * National policies are open-ended modifiers with real trade-offs: every
 * enactment costs political stability and daily upkeep, and no policy is
 * universally best. They are never objectives or missions.
 */
export const POLICIES: PolicyDefinition[] = [
  {
    id: 'pol_free_market',
    name: { en: 'Open Markets', fa: 'بازارهای باز' },
    description: {
      en: 'Lower tariffs and private investment raise trade income and resource output, at the cost of state revenue.',
      fa: 'تعرفه‌های پایین و سرمایه‌گذاری خصوصی درآمد تجارت و تولید منابع را بالا می‌برد، به بهای کاهش درآمد دولت.',
    },
    category: 'economy',
    upkeep: 2,
    politicalCost: 0.015,
    stabilityDrift: 0.0002,
    effects: { trade: 0.22, resource: 0.08, income: -0.06 },
  },
  {
    id: 'pol_state_industry',
    name: { en: 'State Industrial Drive', fa: 'جهش صنعتی دولتی' },
    description: {
      en: 'Directed investment expands military and civilian industry, but strains the treasury and centralises control.',
      fa: 'سرمایه‌گذاری هدایت‌شده صنایع نظامی و غیرنظامی را گسترش می‌دهد، اما خزانه را تحت فشار می‌گذارد.',
    },
    category: 'economy',
    upkeep: 6,
    politicalCost: 0.02,
    stabilityDrift: -0.0001,
    effects: { militaryIndustry: 0.15, civilianIndustry: 0.12, production: 0.08, income: -0.04 },
  },
  {
    id: 'pol_volunteer_army',
    name: { en: 'Volunteer Forces', fa: 'نیروهای داوطلب' },
    description: {
      en: 'Professional recruitment improves readiness and saves manpower, but costs more to sustain.',
      fa: 'نیروگیری حرفه‌ای آمادگی را بهبود می‌دهد و در نیروی انسانی صرفه‌جویی می‌کند، اما نگهداری آن پرهزینه‌تر است.',
    },
    category: 'military',
    upkeep: 5,
    politicalCost: 0.01,
    stabilityDrift: 0,
    effects: { attack: 0.06, defence: 0.04, manpower: -0.12, income: -0.04 },
  },
  {
    id: 'pol_mass_mobilization',
    name: { en: 'Mass Mobilisation', fa: 'بسیج عمومی' },
    description: {
      en: 'Broad conscription expands the manpower pool and recruitment speed, but raises unrest and lowers readiness.',
      fa: 'خدمت اجباری گسترده ذخیره نیروی انسانی و سرعت نیروگیری را افزایش می‌دهد، اما نارضایتی را بالا و آمادگی را پایین می‌آورد.',
    },
    category: 'mobilization',
    upkeep: 3,
    politicalCost: 0.035,
    stabilityDrift: -0.0008,
    effects: { manpower: 0.3, attack: 0.03, defence: 0.04, readiness: -0.05 },
  },
  {
    id: 'pol_science_priority',
    name: { en: 'Science Priority', fa: 'اولویت علم' },
    description: {
      en: 'Public research campuses accelerate technology at the expense of short-term industrial output.',
      fa: 'پژوهشگاه‌های عمومی فناوری را شتاب می‌دهند، به بهای کاهش تولید صنعتی کوتاه‌مدت.',
    },
    category: 'research',
    upkeep: 4,
    politicalCost: 0.01,
    stabilityDrift: 0.0001,
    effects: { research: 0.24, production: -0.05, detection: 0.05 },
  },
  {
    id: 'pol_logistics_first',
    name: { en: 'Logistics First', fa: 'تدارکات در اولویت' },
    description: {
      en: 'Depots, rail priority and convoy escorts improve supply and logistics throughput, slowing civilian construction.',
      fa: 'انبارها، اولویت راه‌آهن و اسکورت کاروان‌ها تدارکات را بهبود می‌دهد و ساخت‌وساز غیرنظامی را کند می‌کند.',
    },
    category: 'logistics',
    upkeep: 4,
    politicalCost: 0.01,
    stabilityDrift: 0,
    effects: { supply: 0.18, logistics: 0.2, production: -0.04 },
  },
  {
    id: 'pol_open_trade',
    name: { en: 'Trade Liberalisation', fa: 'آزادسازی تجارت' },
    description: {
      en: 'Foreign trade agreements and port access boost trade capacity and income, but expose the economy to blockades.',
      fa: 'توافق‌های تجاری و دسترسی بندری ظرفیت تجارت و درآمد را بالا می‌برد، اما اقتصاد را در برابر محاصره آسیب‌پذیر می‌کند.',
    },
    category: 'trade',
    upkeep: 2,
    politicalCost: 0.012,
    stabilityDrift: 0.0002,
    effects: { trade: 0.3, income: 0.06, logistics: 0.05 },
  },
  {
    id: 'pol_security_state',
    name: { en: 'Security Cabinet', fa: 'کابینه امنیتی' },
    description: {
      en: 'Expanded intelligence and internal security raise detection and stability, but suppress research and trade.',
      fa: 'اطلاعات و امنیت داخلی گسترده تشخیص و ثبات را بالا می‌برد، اما پژوهش و تجارت را محدود می‌کند.',
    },
    category: 'stability',
    upkeep: 5,
    politicalCost: 0.02,
    stabilityDrift: 0.0006,
    effects: { detection: 0.22, defence: 0.05, research: -0.06, trade: -0.08 },
  },
  {
    id: 'pol_diplomatic_corps',
    name: { en: 'Diplomatic Corps', fa: 'سپاه دیپلماتیک' },
    description: {
      en: 'A larger foreign service improves relations and intelligence sharing, with little direct economic benefit.',
      fa: 'دستگاه دیپلماسی بزرگ‌تر روابط و اشتراک اطلاعات را بهبود می‌دهد، با سود اقتصادی مستقیم اندک.',
    },
    category: 'diplomacy',
    upkeep: 3,
    politicalCost: 0,
    stabilityDrift: 0.0003,
    effects: { detection: 0.08, trade: 0.1, income: -0.02 },
  },
  {
    id: 'pol_austerity',
    name: { en: 'Austerity Programme', fa: 'برنامه ریاضت' },
    description: {
      en: 'Spending cuts restore the treasury but reduce research, readiness and public stability.',
      fa: 'کاهش هزینه‌ها خزانه را ترمیم می‌کند، اما پژوهش، آمادگی و ثبات عمومی را کاهش می‌دهد.',
    },
    category: 'economy',
    upkeep: -8,
    politicalCost: 0.04,
    stabilityDrift: -0.001,
    effects: { research: -0.08, production: -0.06, defence: -0.03 },
  },
  {
    id: 'pol_civil_defence',
    name: { en: 'Civil Defence Network', fa: 'شبکه دفاع شهری' },
    description: {
      en: 'Shelters, radar and local reserves reduce damage and improve defence, but consume construction capacity.',
      fa: 'پناهگاه‌ها، رادار و ذخیره‌های محلی خسارت را کاهش و دفاع را بهبود می‌دهند، اما ظرفیت ساخت‌وساز را می‌بلعند.',
    },
    category: 'stability',
    upkeep: 3,
    politicalCost: 0.005,
    stabilityDrift: 0.0003,
    effects: { defence: 0.09, detection: 0.08, production: -0.06 },
  },
];

export const POLICY_BY_ID: Record<string, PolicyDefinition> = Object.fromEntries(
  POLICIES.map((policy) => [policy.id, policy]),
);

export const getPolicy = (id: string): PolicyDefinition | undefined => POLICY_BY_ID[id];
