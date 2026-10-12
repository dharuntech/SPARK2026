'use strict';
/**
 * Time helpers. Every timestamp is stored as a UTC instant (timestamptz) and
 * rendered in Asia/Kolkata (IST, UTC+05:30) for students, admins and exports.
 */
const env = require('../config/env');

const TZ = env.timezone; // 'Asia/Kolkata'
const IST_OFFSET_MINUTES = 330;

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric',
});
const dayMonthFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ, day: '2-digit', month: 'short',
});
const weekdayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true,
});
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
});

/** "2026-10-18" + "10:00" (both understood as IST) -> UTC Date instant */
function istInputToDate(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
  const t = /^\d{2}:\d{2}$/.test(String(timeStr || '')) ? timeStr : '00:00';
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMs);
}

/** UTC Date -> "2026-10-18" and "10:00" in IST, for pre-filling admin forms */
function dateToIstInputs(date) {
  if (!date) return { date: '', time: '' };
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
const fmtDayMonth = (d) => (d ? dayMonthFmt.format(new Date(d)) : '');
const fmtWeekday = (d) => (d ? weekdayFmt.format(new Date(d)) : '');
const fmtTime = (d) => (d ? timeFmt.format(new Date(d)).toUpperCase().replace(/\s+/g, ' ') : '');
const fmtDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '');

/** "18 Oct 2026 · 10:00 AM – 12:00 PM" */
function fmtRange(startsAt, endsAt) {
  if (!startsAt) return '';
  const start = fmtTime(startsAt);
  const end = endsAt ? fmtTime(endsAt) : '';
  return end ? `${start} – ${end}` : start;
}

module.exports = {
  TZ,
  istInputToDate,
  dateToIstInputs,
  fmtDate,
  fmtDayMonth,
  fmtWeekday,
  fmtTime,
  fmtDateTime,
  fmtRange,
};
