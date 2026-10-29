// fmt.js — one shared place for date and money formatting (follows the Settings page).

export const DATE_FORMATS = {
  medium: 'Day Month Year (5 Sep 2026)',
  dmy: 'Day/Month/Year (05/09/2026)',
  mdy: 'Month/Day/Year (09/05/2026)',
  ymd: 'Year-Month-Day (2026-09-05)',
};
export const NUMBER_LOCALES = {
  'en-IN': 'Indian grouping (1,25,000.00)',
  'en-US': 'International grouping (125,000.00)',
  'de-DE': 'European style (125.000,00)',
};
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED', 'JPY'];

const cfg = { currency: 'INR', dateFormat: 'medium', numberLocale: 'en-IN', currencyDisplay: 'symbol' };

export function configure(settings = {}) {
  if (CURRENCIES.includes(settings.currency)) cfg.currency = settings.currency;
  if (DATE_FORMATS[settings.dateFormat]) cfg.dateFormat = settings.dateFormat;
  if (NUMBER_LOCALES[settings.numberLocale]) cfg.numberLocale = settings.numberLocale;
  if (settings.currencyDisplay === 'symbol' || settings.currencyDisplay === 'code') cfg.currencyDisplay = settings.currencyDisplay;
}

export const currentCurrency = () => cfg.currency;

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Formats a YYYY-MM-DD date or an ISO timestamp using the chosen date format. */
export function date(value) {
  const d = toDate(value);
  if (!d) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  switch (cfg.dateFormat) {
    case 'dmy': return `${pad(day)}/${pad(m)}/${y}`;
    case 'mdy': return `${pad(m)}/${pad(day)}/${y}`;
    case 'ymd': return `${y}-${pad(m)}-${pad(day)}`;
    default: return `${day} ${MONTHS[m - 1]} ${y}`;
  }
}

export function dateTime(iso) {
  const d = toDate(iso);
  if (!d) return '';
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${date(iso)}, ${h}:${pad(d.getMinutes())} ${ap}`;
}

export function money(amount, currency) {
  if (amount === '' || amount == null || Number.isNaN(Number(amount))) return '';
  const cur = currency || cfg.currency;
  try {
    return new Intl.NumberFormat(cfg.numberLocale, {
      style: 'currency',
      currency: cur,
      currencyDisplay: cfg.currencyDisplay === 'code' ? 'code' : 'symbol',
      maximumFractionDigits: cur === 'JPY' ? 0 : 2,
      minimumFractionDigits: cur === 'JPY' ? 0 : 2,
    }).format(Number(amount));
  } catch {
    return `${cur} ${Number(amount).toFixed(2)}`;
  }
}

export const monthName = (y, m) => new Date(y, m, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
