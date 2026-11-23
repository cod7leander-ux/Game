import type { LocalizedText } from '../i18n/types';

/**
 * Strategic cities. Tier 1 = capital, 2 = major city, 3 = strategic hub.
 * Coordinates are approximate city centres. This catalogue grows into the
 * regional/city tier of the world map.
 */
export interface CityDefinition {
  id: string;
  countryId: string;
  name: LocalizedText;
  /** [lon, lat] */
  position: [number, number];
  tier: 1 | 2 | 3;
}

export const CITIES: CityDefinition[] = [
  { id: 'tehran', countryId: 'IRN', name: { en: 'Tehran', fa: 'تهران' }, position: [51.39, 35.69], tier: 1 },
  { id: 'isfahan', countryId: 'IRN', name: { en: 'Isfahan', fa: 'اصفهان' }, position: [51.67, 32.65], tier: 2 },
  { id: 'bandar-abbas', countryId: 'IRN', name: { en: 'Bandar Abbas', fa: 'بندرعباس' }, position: [56.27, 27.18], tier: 3 },
  { id: 'ankara', countryId: 'TUR', name: { en: 'Ankara', fa: 'آنکارا' }, position: [32.85, 39.93], tier: 1 },
  { id: 'istanbul', countryId: 'TUR', name: { en: 'Istanbul', fa: 'استانبول' }, position: [28.98, 41.01], tier: 2 },
  { id: 'riyadh', countryId: 'SAU', name: { en: 'Riyadh', fa: 'ریاض' }, position: [46.72, 24.63], tier: 1 },
  { id: 'jeddah', countryId: 'SAU', name: { en: 'Jeddah', fa: 'جده' }, position: [39.17, 21.49], tier: 3 },
  { id: 'cairo', countryId: 'EGY', name: { en: 'Cairo', fa: 'قاهره' }, position: [31.24, 30.04], tier: 1 },
  { id: 'alexandria', countryId: 'EGY', name: { en: 'Alexandria', fa: 'اسکندریه' }, position: [29.92, 31.2], tier: 3 },
  { id: 'baghdad', countryId: 'IRQ', name: { en: 'Baghdad', fa: 'بغداد' }, position: [44.36, 33.31], tier: 1 },
  { id: 'basra', countryId: 'IRQ', name: { en: 'Basra', fa: 'بصره' }, position: [47.78, 30.5], tier: 3 },
  { id: 'kabul', countryId: 'AFG', name: { en: 'Kabul', fa: 'کابل' }, position: [69.21, 34.53], tier: 1 },
  { id: 'islamabad', countryId: 'PAK', name: { en: 'Islamabad', fa: 'اسلام‌آباد' }, position: [73.06, 33.68], tier: 1 },
  { id: 'karachi', countryId: 'PAK', name: { en: 'Karachi', fa: 'کراچی' }, position: [67.01, 24.86], tier: 2 },
  { id: 'new-delhi', countryId: 'IND', name: { en: 'New Delhi', fa: 'دهلی نو' }, position: [77.21, 28.61], tier: 1 },
  { id: 'mumbai', countryId: 'IND', name: { en: 'Mumbai', fa: 'بمبئی' }, position: [72.88, 19.08], tier: 2 },
  { id: 'beijing', countryId: 'CHN', name: { en: 'Beijing', fa: 'پکن' }, position: [116.41, 39.9], tier: 1 },
  { id: 'shanghai', countryId: 'CHN', name: { en: 'Shanghai', fa: 'شانگهای' }, position: [121.47, 31.23], tier: 2 },
  { id: 'tokyo', countryId: 'JPN', name: { en: 'Tokyo', fa: 'توکیو' }, position: [139.69, 35.69], tier: 1 },
  { id: 'osaka', countryId: 'JPN', name: { en: 'Osaka', fa: 'اوساکا' }, position: [135.5, 34.69], tier: 3 },
  { id: 'seoul', countryId: 'KOR', name: { en: 'Seoul', fa: 'سئول' }, position: [126.98, 37.57], tier: 1 },
  { id: 'hanoi', countryId: 'VNM', name: { en: 'Hanoi', fa: 'هانوی' }, position: [105.83, 21.03], tier: 1 },
  { id: 'jakarta', countryId: 'IDN', name: { en: 'Jakarta', fa: 'جاکارتا' }, position: [106.85, -6.21], tier: 1 },
  { id: 'bangkok', countryId: 'THA', name: { en: 'Bangkok', fa: 'بانکوک' }, position: [100.5, 13.76], tier: 1 },
  { id: 'moscow', countryId: 'RUS', name: { en: 'Moscow', fa: 'مسکو' }, position: [37.62, 55.76], tier: 1 },
  { id: 'vladivostok', countryId: 'RUS', name: { en: 'Vladivostok', fa: 'ولادی‌وستوک' }, position: [131.89, 43.12], tier: 3 },
  { id: 'kyiv', countryId: 'UKR', name: { en: 'Kyiv', fa: 'کی‌یف' }, position: [30.52, 50.45], tier: 1 },
  { id: 'warsaw', countryId: 'POL', name: { en: 'Warsaw', fa: 'ورشو' }, position: [21.01, 52.23], tier: 1 },
  { id: 'berlin', countryId: 'DEU', name: { en: 'Berlin', fa: 'برلین' }, position: [13.4, 52.52], tier: 1 },
  { id: 'paris', countryId: 'FRA', name: { en: 'Paris', fa: 'پاریس' }, position: [2.35, 48.86], tier: 1 },
  { id: 'london', countryId: 'GBR', name: { en: 'London', fa: 'لندن' }, position: [-0.13, 51.51], tier: 1 },
  { id: 'madrid', countryId: 'ESP', name: { en: 'Madrid', fa: 'مادرید' }, position: [-3.7, 40.42], tier: 1 },
  { id: 'rome', countryId: 'ITA', name: { en: 'Rome', fa: 'رم' }, position: [12.5, 41.9], tier: 1 },
  { id: 'amsterdam', countryId: 'NLD', name: { en: 'Amsterdam', fa: 'آمستردام' }, position: [4.9, 52.37], tier: 1 },
  { id: 'stockholm', countryId: 'SWE', name: { en: 'Stockholm', fa: 'استکهلم' }, position: [18.06, 59.33], tier: 1 },
  { id: 'oslo', countryId: 'NOR', name: { en: 'Oslo', fa: 'اسلو' }, position: [10.75, 59.91], tier: 1 },
  { id: 'helsinki', countryId: 'FIN', name: { en: 'Helsinki', fa: 'هلسینکی' }, position: [24.94, 60.17], tier: 1 },
  { id: 'athens', countryId: 'GRC', name: { en: 'Athens', fa: 'آتن' }, position: [23.73, 37.98], tier: 1 },
  { id: 'ankara-east', countryId: 'ARM', name: { en: 'Yerevan', fa: 'ایروان' }, position: [44.51, 40.18], tier: 1 },
  { id: 'baku', countryId: 'AZE', name: { en: 'Baku', fa: 'باکو' }, position: [49.87, 40.41], tier: 1 },
  { id: 'tashkent', countryId: 'UZB', name: { en: 'Tashkent', fa: 'تاشکند' }, position: [69.24, 41.3], tier: 1 },
  { id: 'astana', countryId: 'KAZ', name: { en: 'Astana', fa: 'آستانه' }, position: [71.43, 51.17], tier: 1 },
  { id: 'washington', countryId: 'USA', name: { en: 'Washington D.C.', fa: 'واشینگتن دی‌سی' }, position: [-77.04, 38.9], tier: 1 },
  { id: 'new-york', countryId: 'USA', name: { en: 'New York', fa: 'نیویورک' }, position: [-74.01, 40.71], tier: 2 },
  { id: 'los-angeles', countryId: 'USA', name: { en: 'Los Angeles', fa: 'لس‌آنجلس' }, position: [-118.24, 34.05], tier: 2 },
  { id: 'ottawa', countryId: 'CAN', name: { en: 'Ottawa', fa: 'اتاوا' }, position: [-75.7, 45.42], tier: 1 },
  { id: 'mexico-city', countryId: 'MEX', name: { en: 'Mexico City', fa: 'مکزیکوسیتی' }, position: [-99.13, 19.43], tier: 1 },
  { id: 'havana', countryId: 'CUB', name: { en: 'Havana', fa: 'هاوانا' }, position: [-82.37, 23.11], tier: 1 },
  { id: 'brasilia', countryId: 'BRA', name: { en: 'Brasília', fa: 'برازیلیا' }, position: [-47.88, -15.79], tier: 1 },
  { id: 'rio', countryId: 'BRA', name: { en: 'Rio de Janeiro', fa: 'ریودوژانیرو' }, position: [-43.17, -22.91], tier: 2 },
  { id: 'buenos-aires', countryId: 'ARG', name: { en: 'Buenos Aires', fa: 'بوئنوس آیرس' }, position: [-58.38, -34.6], tier: 1 },
  { id: 'santiago', countryId: 'CHL', name: { en: 'Santiago', fa: 'سانتیاگو' }, position: [-70.67, -33.45], tier: 1 },
  { id: 'lima', countryId: 'PER', name: { en: 'Lima', fa: 'لیما' }, position: [-77.04, -12.05], tier: 1 },
  { id: 'bogota', countryId: 'COL', name: { en: 'Bogotá', fa: 'بوگوتا' }, position: [-74.07, 4.71], tier: 1 },
  { id: 'caracas', countryId: 'VEN', name: { en: 'Caracas', fa: 'کاراکاس' }, position: [-66.9, 10.48], tier: 1 },
  { id: 'pretoria', countryId: 'ZAF', name: { en: 'Pretoria', fa: 'پرتوریا' }, position: [28.19, -25.75], tier: 1 },
  { id: 'nairobi', countryId: 'KEN', name: { en: 'Nairobi', fa: 'نایروبی' }, position: [36.82, -1.29], tier: 1 },
  { id: 'addis-ababa', countryId: 'ETH', name: { en: 'Addis Ababa', fa: 'آدیس آبابا' }, position: [38.75, 9.02], tier: 1 },
  { id: 'lagos', countryId: 'NGA', name: { en: 'Lagos', fa: 'لاگوس' }, position: [3.39, 6.46], tier: 1 },
  { id: 'accra', countryId: 'GHA', name: { en: 'Accra', fa: 'آکرا' }, position: [-0.19, 5.6], tier: 1 },
  { id: 'casablanca', countryId: 'MAR', name: { en: 'Rabat', fa: 'رباط' }, position: [-6.85, 34.02], tier: 1 },
  { id: 'algiers', countryId: 'DZA', name: { en: 'Algiers', fa: 'الجزیره' }, position: [3.06, 36.75], tier: 1 },
  { id: 'tunis', countryId: 'TUN', name: { en: 'Tunis', fa: 'تونس' }, position: [10.18, 36.81], tier: 1 },
  { id: 'tripoli', countryId: 'LBY', name: { en: 'Tripoli', fa: 'طرابلس' }, position: [13.19, 32.89], tier: 1 },
  { id: 'khartoum', countryId: 'SDN', name: { en: 'Khartoum', fa: 'خارطوم' }, position: [32.53, 15.5], tier: 1 },
  { id: 'doha', countryId: 'QAT', name: { en: 'Doha', fa: 'دوحه' }, position: [51.53, 25.29], tier: 1 },
  { id: 'abu-dhabi', countryId: 'ARE', name: { en: 'Abu Dhabi', fa: 'ابوظبی' }, position: [54.37, 24.45], tier: 1 },
  { id: 'muscat', countryId: 'OMN', name: { en: 'Muscat', fa: 'مسقط' }, position: [58.41, 23.59], tier: 1 },
  { id: 'kuwait-city', countryId: 'KWT', name: { en: 'Kuwait City', fa: 'کویت' }, position: [47.98, 29.38], tier: 1 },
  { id: 'amman', countryId: 'JOR', name: { en: 'Amman', fa: 'امان' }, position: [35.93, 31.95], tier: 1 },
  { id: 'damascus', countryId: 'SYR', name: { en: 'Damascus', fa: 'دمشق' }, position: [36.29, 33.51], tier: 1 },
  { id: 'beirut', countryId: 'LBN', name: { en: 'Beirut', fa: 'بیروت' }, position: [35.5, 33.89], tier: 1 },
  { id: 'tbilisi', countryId: 'GEO', name: { en: 'Tbilisi', fa: 'تفلیس' }, position: [44.79, 41.72], tier: 1 },
  { id: 'canberra', countryId: 'AUS', name: { en: 'Canberra', fa: 'کانبرا' }, position: [149.13, -35.28], tier: 1 },
  { id: 'wellington', countryId: 'NZL', name: { en: 'Wellington', fa: 'ولینگتون' }, position: [174.78, -41.29], tier: 1 },
  { id: 'ulaanbaatar', countryId: 'MNG', name: { en: 'Ulaanbaatar', fa: 'اولان‌باتور' }, position: [106.91, 47.89], tier: 1 },
];

export const CITY_BY_ID: Record<string, CityDefinition> = Object.fromEntries(
  CITIES.map((city) => [city.id, city]),
);

export const capitalOf = (countryId: string): CityDefinition | undefined =>
  CITIES.find((city) => city.countryId === countryId && city.tier === 1);

export const citiesOf = (countryId: string): CityDefinition[] =>
  CITIES.filter((city) => city.countryId === countryId);
