import type { ResearchBranch, TechDefinition } from '../gameplay/research/types';

/**
 * Research tree. Branches are independent ladders joined by prerequisites.
 * Effects are declarative and applied by the country modifier recomputation.
 */
export const TECHNOLOGIES: TechDefinition[] = [
  {
    id: 'ind_assembly',
    name: { en: 'Modular Assembly Lines', fa: 'خطوط مونتاژ مدولار' },
    description: {
      en: 'Standardised hulls and fittings raise industrial throughput.',
      fa: 'بدنه‌ها و اتصالات استاندارد، بازده صنعتی را بالا می‌برند.',
    },
    branch: 'industry',
    tier: 1,
    cost: 320,
    days: 30,
    requires: [],
    effects: [
      { kind: 'production', value: 0.1 },
      { kind: 'unlockUnit', value: 0, unitId: 'inf_mech' },
    ],
  },
  {
    id: 'ind_automation',
    name: { en: 'Automated Fabrication', fa: 'ساخت خودکار' },
    description: {
      en: 'Robotic welding cells cut build times for armoured vehicles.',
      fa: 'خطوط جوش رباتیک، زمان ساخت خودروهای زرهی را کاهش می‌دهد.',
    },
    branch: 'industry',
    tier: 2,
    cost: 720,
    days: 50,
    requires: ['ind_assembly'],
    effects: [
      { kind: 'production', value: 0.15 },
      { kind: 'unlockUnit', value: 0, unitId: 'veh_ifv' },
      { kind: 'unlockUnit', value: 0, unitId: 'art_rocket' },
    ],
  },
  {
    id: 'ind_composites',
    name: { en: 'Composite Manufacturing', fa: 'تولید کامپوزیت' },
    description: {
      en: 'Advanced composites reduce weight across airframes and hulls.',
      fa: 'کامپوزیت‌های پیشرفته وزن هواگردها و بدنه‌ها را کاهش می‌دهند.',
    },
    branch: 'industry',
    tier: 3,
    cost: 1450,
    days: 80,
    requires: ['ind_automation'],
    effects: [
      { kind: 'production', value: 0.12 },
      { kind: 'defence', value: 0.05 },
    ],
  },
  {
    id: 'nrg_grid',
    name: { en: 'National Grid Expansion', fa: 'توسعه شبکه ملی برق' },
    description: {
      en: 'Interconnected grids lower industrial energy costs.',
      fa: 'شبکه‌های به‌هم‌پیوسته هزینه انرژی صنعتی را کاهش می‌دهند.',
    },
    branch: 'energy',
    tier: 1,
    cost: 300,
    days: 28,
    requires: [],
    effects: [{ kind: 'income', value: 0.08 }],
  },
  {
    id: 'nrg_synthetic',
    name: { en: 'Synthetic Fuel Plants', fa: 'کارخانه سوخت مصنوعی' },
    description: {
      en: 'Coal-to-liquid plants blunt the effect of oil shortages.',
      fa: 'کارخانه‌های تبدیل زغال‌سنگ به مایع، اثر کمبود نفت را کاهش می‌دهند.',
    },
    branch: 'energy',
    tier: 2,
    cost: 780,
    days: 55,
    requires: ['nrg_grid'],
    effects: [
      { kind: 'income', value: 0.1 },
      { kind: 'stability', value: 0.02 },
    ],
  },
  {
    id: 'arm_plating',
    name: { en: 'Composite Armour', fa: 'زره کامپوزیتی' },
    description: {
      en: 'Layered ceramic and steel arrays improve survivability.',
      fa: 'لایه‌های سرامیکی و فولادی، بقاپذیری را بهبود می‌دهند.',
    },
    branch: 'armor',
    tier: 1,
    cost: 360,
    days: 32,
    requires: [],
    effects: [
      { kind: 'defence', value: 0.08 },
      { kind: 'unlockUnit', value: 0, unitId: 'tank_light' },
    ],
  },
  {
    id: 'arm_reactive',
    name: { en: 'Reactive Armour', fa: 'زره واکنشی' },
    description: {
      en: 'Explosive reactive tiles defeat shaped-charge warheads.',
      fa: 'صفحات واکنشی انفجاری، سرجنگی‌های خرج‌شکل را خنثی می‌کنند.',
    },
    branch: 'armor',
    tier: 2,
    cost: 820,
    days: 60,
    requires: ['arm_plating'],
    effects: [
      { kind: 'defence', value: 0.12 },
      { kind: 'unlockUnit', value: 0, unitId: 'tank_mbt' },
    ],
  },
  {
    id: 'arm_autoloader',
    name: { en: 'Autoloaded Main Guns', fa: 'توپ اصلی خودبارگذاری' },
    description: {
      en: 'Faster reload cycles and a smaller turret crew.',
      fa: 'چرخه بارگذاری سریع‌تر و خدمه کمتر برجک.',
    },
    branch: 'armor',
    tier: 3,
    cost: 1650,
    days: 90,
    requires: ['arm_reactive'],
    effects: [
      { kind: 'attack', value: 0.1 },
      { kind: 'unlockUnit', value: 0, unitId: 'tank_heavy' },
    ],
  },
  {
    id: 'air_jet',
    name: { en: 'Jet Propulsion', fa: 'پیشرانه جت' },
    description: {
      en: 'Afterburning turbofans open the modern combat aircraft branch.',
      fa: 'توربوفن‌های پس‌سوز، شاخه هواگردهای رزمی مدرن را می‌گشاید.',
    },
    branch: 'aviation',
    tier: 1,
    cost: 460,
    days: 38,
    requires: [],
    effects: [
      { kind: 'unlockUnit', value: 0, unitId: 'air_fighter' },
      { kind: 'unlockUnit', value: 0, unitId: 'air_interceptor' },
      { kind: 'unlockUnit', value: 0, unitId: 'air_groundattack' },
    ],
  },
  {
    id: 'air_multirole',
    name: { en: 'Multirole Airframes', fa: 'بدنه چندنقشه' },
    description: {
      en: 'One airframe, many missions: interception, strike and escort.',
      fa: 'یک بدنه، چند مأموریت: رهگیری، ضربه و اسکورت.',
    },
    branch: 'aviation',
    tier: 2,
    cost: 980,
    days: 65,
    requires: ['air_jet'],
    effects: [
      { kind: 'unlockUnit', value: 0, unitId: 'air_multirole' },
      { kind: 'attack', value: 0.05 },
    ],
  },
  {
    id: 'air_uav',
    name: { en: 'Autonomous Flight Control', fa: 'کنترل پرواز خودگردان' },
    description: {
      en: 'Unmanned systems take over reconnaissance and armed patrol.',
      fa: 'سامانه‌های بی‌سرنشین، شناسایی و گشت مسلح را برعهده می‌گیرند.',
    },
    branch: 'aviation',
    tier: 2,
    cost: 860,
    days: 58,
    requires: ['air_jet'],
    effects: [
      { kind: 'unlockUnit', value: 0, unitId: 'air_uav' },
      { kind: 'unlockUnit', value: 0, unitId: 'air_recon' },
      { kind: 'unlockUnit', value: 0, unitId: 'air_attackheli' },
    ],
  },
  {
    id: 'air_stealth',
    name: { en: 'Low-Observable Design', fa: 'طراحی کم‌پیدا' },
    description: {
      en: 'Radar-absorbent structures enable deep strike aircraft.',
      fa: 'سازه‌های جاذب رادار، هواگردهای ضربه عمیق را ممکن می‌کنند.',
    },
    branch: 'aviation',
    tier: 3,
    cost: 1850,
    days: 100,
    requires: ['air_multirole'],
    effects: [
      { kind: 'unlockUnit', value: 0, unitId: 'air_bomber' },
      { kind: 'defence', value: 0.04 },
    ],
  },
  {
    id: 'nav_hull',
    name: { en: 'Modular Hull Design', fa: 'طراحی بدنه مدولار' },
    description: {
      en: 'Standard hull sections shorten construction of escorts.',
      fa: 'بخش‌های استاندارد بدنه، ساخت ناوچه‌ها را کوتاه می‌کند.',
    },
    branch: 'naval',
    tier: 1,
    cost: 420,
    days: 36,
    requires: [],
    effects: [
      { kind: 'unlockUnit', value: 0, unitId: 'nav_corvette' },
      { kind: 'unlockUnit', value: 0, unitId: 'nav_frigate' },
      { kind: 'unlockUnit', value: 0, unitId: 'nav_submarine' },
    ],
  },
  {
    id: 'nav_deck',
    name: { en: 'Deck & Elevator Systems', fa: 'سامانه عرشه و بالابر' },
    description: {
      en: 'Large-deck engineering for destroyers and carriers.',
      fa: 'مهندسی عرشه بزرگ برای ناوشکن‌ها و ناوهای هواپیمابر.',
    },
    branch: 'naval',
    tier: 2,
    cost: 1200,
    days: 78,
    requires: ['nav_hull'],
    effects: [{ kind: 'unlockUnit', value: 0, unitId: 'nav_destroyer' }],
  },
  {
    id: 'nav_carrier',
    name: { en: 'Carrier Doctrine', fa: 'دکترین ناو هواپیمابر' },
    description: {
      en: 'Integrated air wings, deck cycles and fleet logistics.',
      fa: 'بال‌های هوایی یکپارچه، چرخه عرشه و لجستیک ناوگان.',
    },
    branch: 'naval',
    tier: 3,
    cost: 2400,
    days: 130,
    requires: ['nav_deck'],
    effects: [{ kind: 'unlockUnit', value: 0, unitId: 'nav_carrier' }],
  },
  {
    id: 'elec_radar',
    name: { en: 'AESA Radar', fa: 'رادار آرایه فازی' },
    description: {
      en: 'Electronic scanning dramatically extends detection range.',
      fa: 'اسکن الکترونیکی برد کشف را به‌شدت افزایش می‌دهد.',
    },
    branch: 'electronics',
    tier: 1,
    cost: 440,
    days: 36,
    requires: [],
    effects: [
      { kind: 'defence', value: 0.06 },
      { kind: 'unlockUnit', value: 0, unitId: 'ad_short' },
      { kind: 'unlockUnit', value: 0, unitId: 'sup_radar' },
    ],
  },
  {
    id: 'elec_computing',
    name: { en: 'Integrated Combat Networks', fa: 'شبکه‌های رزمی یکپارچه' },
    description: {
      en: 'Shared tracks and machine-speed targeting across the force.',
      fa: 'ردیابی مشترک و هدف‌گیری با سرعت ماشین در کل نیرو.',
    },
    branch: 'electronics',
    tier: 2,
    cost: 900,
    days: 62,
    requires: ['elec_radar'],
    effects: [
      { kind: 'research', value: 0.1 },
      { kind: 'attack', value: 0.05 },
      { kind: 'unlockUnit', value: 0, unitId: 'mis_tactical' },
      { kind: 'unlockUnit', value: 0, unitId: 'inf_special' },
    ],
  },
  {
    id: 'elec_ew',
    name: { en: 'Electronic Warfare Suites', fa: 'سامانه‌های جنگ الکترونیک' },
    description: {
      en: 'Jamming, decoys and emissions control deny the enemy the picture.',
      fa: 'اخلال، فریب و کنترل انتشار، تصویر دشمن را از بین می‌برد.',
    },
    branch: 'electronics',
    tier: 3,
    cost: 1500,
    days: 85,
    requires: ['elec_computing'],
    effects: [
      { kind: 'defence', value: 0.07 },
      { kind: 'unlockUnit', value: 0, unitId: 'sup_ew' },
      { kind: 'unlockUnit', value: 0, unitId: 'ad_missile' },
    ],
  },
  {
    id: 'mis_guidance',
    name: { en: 'Precision Guidance', fa: 'هدایت دقیق' },
    description: {
      en: 'Terrain-referenced navigation makes long-range strike practical.',
      fa: 'ناوبری مبتنی بر عوارض زمین، ضربه دوربرد را عملی می‌کند.',
    },
    branch: 'electronics',
    tier: 3,
    cost: 1700,
    days: 92,
    requires: ['elec_computing'],
    effects: [
      { kind: 'unlockUnit', value: 0, unitId: 'mis_cruise' },
      { kind: 'attack', value: 0.06 },
    ],
  },
  {
    id: 'log_supply',
    name: { en: 'Forward Supply Depots', fa: 'انبارهای تدارکاتی پیشرو' },
    description: {
      en: 'Prepositioned stocks keep formations in the field longer.',
      fa: 'ذخایر پیش‌استقرار، یگان‌ها را بیشتر در میدان نگه می‌دارد.',
    },
    branch: 'logistics',
    tier: 1,
    cost: 340,
    days: 30,
    requires: [],
    effects: [
      { kind: 'manpower', value: 15 },
      { kind: 'income', value: 0.04 },
    ],
  },
  {
    id: 'log_rail',
    name: { en: 'Strategic Rail Corridors', fa: 'کریدورهای ریلی راهبردی' },
    description: {
      en: 'Heavy rail moves materiel from factory to front in days.',
      fa: 'راه‌آهن سنگین، تجهیزات را در چند روز از کارخانه به جبهه می‌رساند.',
    },
    branch: 'logistics',
    tier: 2,
    cost: 760,
    days: 54,
    requires: ['log_supply'],
    effects: [
      { kind: 'production', value: 0.08 },
      { kind: 'income', value: 0.04 },
    ],
  },
  // ── Milestone 4 branches ──────────────────────────────────────────────────
  {
    id: 'inf_doctrine',
    name: { en: 'Infantry Doctrine', fa: 'آیین رزم پیاده' },
    description: {
      en: 'Small-unit tactics and fieldcraft make line infantry hold longer.',
      fa: 'تاکتیک یگان‌های کوچک و مهارت میدانی، دوام پیاده‌نظام خط را افزایش می‌دهد.',
    },
    branch: 'infantry',
    tier: 1,
    cost: 280,
    days: 26,
    requires: [],
    effects: [
      { kind: 'defence', value: 0.04 },
      { kind: 'supply', value: 0.03 },
    ],
  },
  {
    id: 'inf_modern',
    name: { en: 'Modern Infantry Equipment', fa: 'تجهیزات نوین پیاده' },
    description: {
      en: 'Optics, body armour and networked radios raise infantry lethality.',
      fa: 'اپتیک، زره بدنی و بی‌سیم شبکه‌ای، توان کشندگی پیاده را بالا می‌برد.',
    },
    branch: 'infantry',
    tier: 2,
    cost: 700,
    days: 48,
    requires: ['inf_doctrine'],
    effects: [{ kind: 'attack', value: 0.04 }],
  },
  {
    id: 'art_barrage',
    name: { en: 'Predicted Fire Control', fa: 'کنترل آتش پیش‌بینی‌شده' },
    description: {
      en: 'Metrological correction and fire plans mass batteries quickly.',
      fa: 'تصحیح هواشناسی و طرح‌های آتش، آتشبارها را سریع متمرکز می‌کند.',
    },
    branch: 'artillery',
    tier: 1,
    cost: 300,
    days: 28,
    requires: [],
    effects: [{ kind: 'attack', value: 0.04 }],
  },
  {
    id: 'hel_rotor',
    name: { en: 'Rotorcraft Maintenance', fa: 'نگهداری بالگرد' },
    description: {
      en: 'Depot-level rotor and gearbox work raises helicopter availability.',
      fa: 'تعمیرات تخصصی روتور و گیربکس، دسترسی به بالگرد را افزایش می‌دهد.',
    },
    branch: 'helicopters',
    tier: 1,
    cost: 420,
    days: 34,
    requires: [],
    effects: [
      { kind: 'defence', value: 0.02 },
      { kind: 'unlockUnit', value: 0, unitId: 'air_attackheli' },
    ],
  },
  {
    id: 'drn_control',
    name: { en: 'Drone Control Links', fa: 'پیوندهای کنترل پهپاد' },
    description: {
      en: 'Encrypted datalinks keep reconnaissance drones over the battlefield.',
      fa: 'پیوندهای داده رمزنگاری‌شده، پهپادهای شناسایی را در میدان نگه می‌دارد.',
    },
    branch: 'drones',
    tier: 1,
    cost: 380,
    days: 30,
    requires: [],
    effects: [
      { kind: 'detection', value: 0.08 },
      { kind: 'unlockUnit', value: 0, unitId: 'air_uav' },
    ],
  },
  {
    id: 'mis_ballistic',
    name: { en: 'Ballistic Missile Production', fa: 'تولید موشک بالستیک' },
    description: {
      en: 'Solid motors and guidance integration enable theatre strike.',
      fa: 'موتور جامد و یکپارچه‌سازی هدایت، ضربه میدانی را ممکن می‌کند.',
    },
    branch: 'missiles',
    tier: 2,
    cost: 980,
    days: 66,
    requires: ['elec_computing'],
    effects: [
      { kind: 'attack', value: 0.05 },
      { kind: 'unlockUnit', value: 0, unitId: 'mis_tactical' },
    ],
  },
  {
    id: 'ad_network',
    name: { en: 'Integrated Air Defence', fa: 'پدافند هوایی یکپارچه' },
    description: {
      en: 'Shared tracks link radar, missiles and interceptors into one net.',
      fa: 'ردیابی مشترک، رادار، موشک و رهگیر را در یک شبکه پیوند می‌دهد.',
    },
    branch: 'airDefence',
    tier: 2,
    cost: 860,
    days: 58,
    requires: ['elec_radar'],
    effects: [
      { kind: 'detection', value: 0.1 },
      { kind: 'defence', value: 0.04 },
    ],
  },
  {
    id: 'rec_eyes',
    name: { en: 'Reconnaissance Network', fa: 'شبکه شناسایی' },
    description: {
      en: 'Ground scouts and signals intercepts feed a common picture.',
      fa: 'شناسایی زمینی و رهگیری مخابرات، تصویری مشترک می‌سازد.',
    },
    branch: 'recon',
    tier: 1,
    cost: 320,
    days: 28,
    requires: [],
    effects: [
      { kind: 'detection', value: 0.12 },
      { kind: 'unlockUnit', value: 0, unitId: 'air_recon' },
    ],
  },
  {
    id: 'adv_stealth',
    name: { en: 'Low-Observable Systems', fa: 'سامانه‌های کم‌ردیاب' },
    description: {
      en: 'Shaping, coatings and emissions control shrink radar signatures.',
      fa: 'شکل‌دهی، پوشش و کنترل انتشار، سطح مقطع راداری را کاهش می‌دهد.',
    },
    branch: 'advanced',
    tier: 3,
    cost: 1900,
    days: 100,
    requires: ['air_stealth', 'mis_guidance'],
    effects: [
      { kind: 'attack', value: 0.05 },
      { kind: 'detection', value: 0.05 },
    ],
  },
];

export const TECH_BY_ID: Record<string, TechDefinition> = Object.fromEntries(
  TECHNOLOGIES.map((tech) => [tech.id, tech]),
);

export const getTech = (id: string): TechDefinition | undefined => TECH_BY_ID[id];

export const BRANCH_ORDER: ResearchBranch[] = [
  'industry',
  'energy',
  'infantry',
  'armor',
  'artillery',
  'aviation',
  'helicopters',
  'drones',
  'naval',
  'missiles',
  'airDefence',
  'recon',
  'electronics',
  'logistics',
  'advanced',
];

export const techsByBranch = (branch: ResearchBranch): TechDefinition[] =>
  TECHNOLOGIES.filter((tech) => tech.branch === branch).sort((a, b) => a.tier - b.tier);

/** Techs that unlock a specific unit, used by the production panel. */
export const techsUnlockingUnit = (unitId: string): TechDefinition[] =>
  TECHNOLOGIES.filter((tech) => tech.effects.some((effect) => effect.unitId === unitId));
