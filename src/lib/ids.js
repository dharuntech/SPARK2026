'use strict';
const crypto = require('crypto');

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters

function randomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

/** Public, human-friendly registration id, e.g. SP26-E01-7KQ3ZM */
function generateRegistrationId(eventCode) {
  const code = String(eventCode || 'EVT').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'EVT';
  return `SP26-${code}-${randomCode(6)}`;
}

/** Opaque 256-bit capability secret used inside the QR code. */
function generateQrToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeRegisterNumber(value) {
  return String(value || '').toUpperCase().replace(/[\s-]+/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

module.exports = {
  randomCode,
  generateRegistrationId,
  generateQrToken,
  sha256,
  timingSafeEqual,
  slugify,
  normalizeRegisterNumber,
  normalizeEmail,
  normalizeName,
};
