import type { AIPersonality, AIPersonalityId } from '../gameplay/ai/types';

/**
 * AI national postures. Weights feed the utility evaluator; they are the only
 * place nationality-specific behaviour is expressed, and new postures can be
 * added without touching the decision engine.
 */
export const PERSONALITIES: Record<AIPersonalityId, AIPersonality> = {
  aggressive: {
    id: 'aggressive',
    name: { en: 'Aggressive', fa: 'تهاجمی' },
    description: {
      en: 'Builds hard, strikes early and treats weakness in its neighbours as an invitation.',
      fa: 'سریع می‌سازد، زود حمله می‌کند و ضعف همسایگان را فرصت می‌بیند.',
    },
    weights: { military: 0.42, economy: 0.18, research: 0.12, diplomacy: 0.08, expansion: 0.2 },
    aggression: 0.86,
    riskTolerance: 0.72,
    preferredDomains: ['ground', 'air', 'support'],
  },
  defensive: {
    id: 'defensive',
    name: { en: 'Defensive', fa: 'دفاعی' },
    description: {
      en: 'Fortifies borders, avoids adventures abroad and answers force with force.',
      fa: 'مرزها را مستحکم می‌کند، از ماجراجویی دوری می‌کند و پاسخ زور را با زور می‌دهد.',
    },
    weights: { military: 0.34, economy: 0.26, research: 0.16, diplomacy: 0.12, expansion: 0.12 },
    aggression: 0.24,
    riskTolerance: 0.28,
    preferredDomains: ['ground', 'support', 'air'],
  },
  expansionist: {
    id: 'expansionist',
    name: { en: 'Expansionist', fa: 'توسعه‌طلب' },
    description: {
      en: 'Looks for weak borders and favourable terrain, then moves the frontier.',
      fa: 'به دنبال مرزهای ضعیف و زمین مناسب است و سپس مرز را جابه‌جا می‌کند.',
    },
    weights: { military: 0.3, economy: 0.2, research: 0.12, diplomacy: 0.08, expansion: 0.3 },
    aggression: 0.66,
    riskTolerance: 0.6,
    preferredDomains: ['ground', 'air', 'support'],
  },
  economic: {
    id: 'economic',
    name: { en: 'Economic', fa: 'اقتصادی' },
    description: {
      en: 'Industrialises first, buys influence, and rarely fights without an advantage.',
      fa: 'نخست صنعتی می‌شود، نفوذ می‌خرد و کمتر بدون برتری می‌جنگد.',
    },
    weights: { military: 0.18, economy: 0.44, research: 0.16, diplomacy: 0.16, expansion: 0.06 },
    aggression: 0.28,
    riskTolerance: 0.34,
    preferredDomains: ['support', 'ground', 'naval'],
  },
  diplomatic: {
    id: 'diplomatic',
    name: { en: 'Diplomatic', fa: 'دیپلماتیک' },
    description: {
      en: 'Builds coalitions, trades widely and isolates its rivals politically.',
      fa: 'ائتلاف می‌سازد، تجارت گسترده دارد و رقبا را سیاسی منزوی می‌کند.',
    },
    weights: { military: 0.2, economy: 0.24, research: 0.16, diplomacy: 0.32, expansion: 0.08 },
    aggression: 0.2,
    riskTolerance: 0.3,
    preferredDomains: ['air', 'support', 'ground'],
  },
  technological: {
    id: 'technological',
    name: { en: 'Technological', fa: 'فناوری‌محور' },
    description: {
      en: 'Prioritises research, then fields a smaller, better-equipped force.',
      fa: 'پژوهش را در اولویت می‌گذارد و سپس نیرویی کوچک‌تر و بهتر تجهیز می‌کند.',
    },
    weights: { military: 0.24, economy: 0.2, research: 0.36, diplomacy: 0.12, expansion: 0.08 },
    aggression: 0.34,
    riskTolerance: 0.4,
    preferredDomains: ['air', 'support', 'naval'],
  },
  naval: {
    id: 'naval',
    name: { en: 'Maritime', fa: 'دریایی' },
    description: {
      en: 'Secures sea lanes, projects power from the water and guards its coast.',
      fa: 'راه‌های دریایی را ایمن می‌کند، از دریا قدرت اعمال می‌کند و از سواحل دفاع می‌کند.',
    },
    weights: { military: 0.3, economy: 0.24, research: 0.18, diplomacy: 0.14, expansion: 0.14 },
    aggression: 0.46,
    riskTolerance: 0.48,
    preferredDomains: ['naval', 'air', 'support'],
  },
  air: {
    id: 'air',
    name: { en: 'Air-minded', fa: 'هوایی' },
    description: {
      en: 'Invests in airpower, strikes at range and values reconnaissance above numbers.',
      fa: 'بر نیروی هوایی سرمایه‌گذاری می‌کند، از راه دور می‌زند و شناسایی را بر شمار نیرو ترجیح می‌دهد.',
    },
    weights: { military: 0.32, economy: 0.2, research: 0.24, diplomacy: 0.1, expansion: 0.14 },
    aggression: 0.54,
    riskTolerance: 0.5,
    preferredDomains: ['air', 'support', 'ground'],
  },
  balanced: {
    id: 'balanced',
    name: { en: 'Balanced', fa: 'متعادل' },
    description: {
      en: 'No extreme. Responds to whichever dimension of power matters most today.',
      fa: 'بدون افراط. به مهم‌ترین بُعد قدرت در هر روز پاسخ می‌دهد.',
    },
    weights: { military: 0.26, economy: 0.24, research: 0.2, diplomacy: 0.16, expansion: 0.14 },
    aggression: 0.44,
    riskTolerance: 0.44,
    preferredDomains: ['ground', 'air', 'support'],
  },
};

export const PERSONALITY_IDS = Object.keys(PERSONALITIES) as AIPersonalityId[];

/** Coastal countries lean maritime; large land powers lean continental. */
export const COASTAL_BIAS: Record<string, AIPersonalityId[]> = {
  naval: ['naval', 'economic', 'diplomatic'],
  land: ['aggressive', 'defensive', 'expansionist', 'technological', 'balanced'],
};
