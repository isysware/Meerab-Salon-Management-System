// src/lib/dates.js
// All date/time helpers locked to Asia/Karachi timezone.

import prisma from '../config/prisma.js';

const TZ = 'Asia/Karachi';

/** Current instant. */
export const nowKarachi = () => new Date();

/**
 * Format a Date object as 'YYYY-MM-DD' in Asia/Karachi timezone.
 * @param {Date} [date]
 */
export const toDateString = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(date);

/** 'HH:MM' (24h) in Asia/Karachi. */
export const toTimeString = (date = new Date()) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);

/**
 * Format a Prisma @db.Date value (stored as UTC midnight) as 'YYYY-MM-DD'.
 * Returns undefined for null/undefined.
 */
export const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);

/** Convert 'YYYY-MM-DD' into the Date Prisma expects for a @db.Date column. */
export const dateOnly = (val) => {
  if (!val) return val;
  const str = val instanceof Date ? val.toISOString().slice(0, 10) : typeof val === 'string' ? val.slice(0, 10) : String(val).slice(0, 10);
  return new Date(`${str}T00:00:00.000Z`);
};

/** Start of day (00:00 Karachi) for 'YYYY-MM-DD' as a UTC Date. */
export const startOfDay = (dateStr) => new Date(`${dateStr}T00:00:00+05:00`);

/** End of day (23:59:59.999 Karachi) for 'YYYY-MM-DD' as a UTC Date. */
export const endOfDay = (dateStr) => new Date(`${dateStr}T23:59:59.999+05:00`);

/**
 * Parse a date range from query params.
 * Accepts: ?date=YYYY-MM-DD (single day) or ?from=...&to=... (or startDate/endDate)
 */
export const parseDateRange = (query) => {
  if (query.date) {
    return { from: startOfDay(query.date), to: endOfDay(query.date) };
  }
  const f = query.from || query.startDate;
  const t = query.to || query.endDate;
  return { from: f ? startOfDay(f) : null, to: t ? endOfDay(t) : null };
};

export const isYmd = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parsed = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
};

// ── Business date ───────────────────────────────────────────────────────────
// The frontend has a "system/demo date" concept. When a businessDate setting exists
// it is used as "today"; otherwise the real Karachi date is used.

export const BUSINESS_DATE_KEY = 'businessDate';

export const getBusinessDate = async (tx = prisma) => {
  const row = await tx.systemSetting.findUnique({ where: { key: BUSINESS_DATE_KEY } });
  const realToday = toDateString();

  if (row?.value) {
    const wasUpdatedToday = row.updatedAt ? toDateString(new Date(row.updatedAt)) === realToday : false;
    // Auto-clear stale override if it was set on a previous day and is in the past.
    // If the user deliberately changed the date today, it remains active until reset.
    if (!wasUpdatedToday && row.value < realToday && process.env.NODE_ENV !== 'test') {
      try {
        await tx.systemSetting.deleteMany({ where: { key: { in: [BUSINESS_DATE_KEY, 'BUSINESS_DATE'] } } });
      } catch (_) {
        // ignore race or read-only
      }
      return realToday;
    }
    return row.value;
  }
  return realToday;
};

export const setBusinessDate = async (dateStr, tx = prisma) => {
  if (!dateStr || dateStr === toDateString()) {
    await clearBusinessDate(tx);
    return;
  }
  await tx.systemSetting.upsert({
    where:  { key: BUSINESS_DATE_KEY },
    update: { value: dateStr },
    create: { key: BUSINESS_DATE_KEY, value: dateStr },
  });
};

export const clearBusinessDate = async (tx = prisma) => {
  await tx.systemSetting.deleteMany({ where: { key: { in: [BUSINESS_DATE_KEY, 'BUSINESS_DATE'] } } });
  return toDateString();
};

export const isBusinessDateOverridden = async (tx = prisma) => {
  const row = await tx.systemSetting.findUnique({ where: { key: BUSINESS_DATE_KEY } });
  const realToday = toDateString();
  return Boolean(row?.value && row.value !== realToday);
};
