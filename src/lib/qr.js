'use strict';
const crypto = require('crypto');
const QRCode = require('qrcode');
const env = require('../config/env');

const PREFIX = 'SPK26';

function sign(payloadB64) {
  return crypto
    .createHmac('sha256', env.sessionSecret)
    .update(`${PREFIX}.${payloadB64}`)
    .digest('base64url')
    .slice(0, 22);
}

/**
 * Builds the signed, non-sensitive string that is encoded into the QR image.
 * Payload carries only internal references (registration id, opaque token,
 * event code) — never personal data. Tampering breaks the HMAC signature.
 */
function buildQrPayload({ registrationId, qrToken, eventCode }) {
  const payload = JSON.stringify({ r: registrationId, t: qrToken, e: eventCode });
  const b64 = Buffer.from(payload, 'utf8').toString('base64url');
  return `${PREFIX}.${b64}.${sign(b64)}`;
}

/** @returns {{ ok:false, reason:'format'|'signature' } | { ok:true, payload:object, eventCode:string }} */
function parseQrPayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, reason: 'format' };
  if (!text.startsWith(`${PREFIX}.`)) {
    // Bare opaque token (64 url-safe chars) is accepted as a fallback.
    if (/^[A-Za-z0-9_-]{40,64}$/.test(text)) return { ok: true, payload: { t: text }, eventCode: null };
    return { ok: false, reason: 'format' };
  }
  const parts = text.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const [, b64, sig] = parts;
  const expected = sign(b64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature' };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (!payload || typeof payload.t !== 'string') return { ok: false, reason: 'format' };
  return { ok: true, payload, eventCode: payload.e || null };
}

/** Genuine, scannable QR images (SVG data URI for the pass card, PNG data URI for downloads). */
async function qrImages(text) {
  const [svgDataUrl, pngDataUrl] = await Promise.all([
    QRCode.toString(text, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1,
      color: { dark: '#0B1026', light: '#FFFFFF' },
    }).then((svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`),
    QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M', margin: 2, width: 420,
      color: { dark: '#0B1026', light: '#FFFFFF' },
    }),
  ]);
  return { svgDataUrl, pngDataUrl };
}

module.exports = { buildQrPayload, parseQrPayload, qrImages };
