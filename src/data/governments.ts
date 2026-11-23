import type { GovernmentDefinition } from '../gameplay/country/types';

/** Government archetypes. Assigned deterministically from country geography. */
export const GOVERNMENTS: GovernmentDefinition[] = [
  {
    id: 'parliamentary',
    name: { en: 'Parliamentary Republic', fa: 'جمهوری پارلمانی' },
    taxModifier: 1.0,
    researchModifier: 1.05,
    stability: 0.78,
    upkeepModifier: 1.0,
    description: {
      en: 'Consensus politics. Balanced income with a strong research culture.',
      fa: 'سیاست اجماعی. درآمد متعادل با فرهنگ پژوهشی قوی.',
    },
  },
  {
    id: 'federal',
    name: { en: 'Federal Union', fa: 'اتحاد فدرال' },
    taxModifier: 0.95,
    researchModifier: 1.1,
    stability: 0.75,
    upkeepModifier: 1.05,
    description: {
      en: 'Decentralised provinces trade autonomy for innovation.',
      fa: 'استان‌های غیرمتمرکز، خودمختاری را با نوآوری معاوضه می‌کنند.',
    },
  },
  {
    id: 'technocracy',
    name: { en: 'Technocratic Council', fa: 'شورای فناورسالار' },
    taxModifier: 0.9,
    researchModifier: 1.3,
    stability: 0.7,
    upkeepModifier: 0.95,
    description: {
      en: 'Engineers in government. Exceptional research, narrower tax base.',
      fa: 'مهندسان در قدرت. پژوهش برجسته، پایه مالیاتی محدودتر.',
    },
  },
  {
    id: 'monarchy',
    name: { en: 'Constitutional Monarchy', fa: 'پادشاهی مشروطه' },
    taxModifier: 1.1,
    researchModifier: 0.95,
    stability: 0.72,
    upkeepModifier: 1.1,
    description: {
      en: 'Ceremony and continuity. Reliable revenue, expensive prestige forces.',
      fa: 'تشریفات و تداوم. درآمد پایدار، نیروهای تشریفاتی پرهزینه.',
    },
  },
  {
    id: 'directorate',
    name: { en: 'National Directorate', fa: 'ریاست ملی' },
    taxModifier: 1.2,
    researchModifier: 0.9,
    stability: 0.62,
    upkeepModifier: 0.9,
    description: {
      en: 'Centralised command. High extraction, brittle public stability.',
      fa: 'فرماندهی متمرکز. استخراج بالا، ثبات عمومی شکننده.',
    },
  },
  {
    id: 'assembly',
    name: { en: 'Popular Assembly', fa: 'مجمع مردمی' },
    taxModifier: 1.05,
    researchModifier: 0.95,
    stability: 0.8,
    upkeepModifier: 1.15,
    description: {
      en: 'Broad participation. Stable society, costly military establishment.',
      fa: 'مشارکت گسترده. جامعه پایدار، ارتش پرهزینه.',
    },
  },
];

export const GOVERNMENT_BY_ID: Record<string, GovernmentDefinition> = Object.fromEntries(
  GOVERNMENTS.map((government) => [government.id, government]),
);

export const getGovernment = (id: string): GovernmentDefinition =>
  GOVERNMENT_BY_ID[id] ?? GOVERNMENTS[0];
