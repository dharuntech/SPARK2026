'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const FileType = require('file-type');
const env = require('../config/env');
const { ApiError } = require('../lib/http');

const IMAGE_TYPES = new Map([
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);
const DOC_TYPES = new Map([
  ...IMAGE_TYPES,
  ['pdf', 'application/pdf'],
]);

/** multer keeps the file in memory so we can sniff the real content type before touching disk. */
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 3 },
  fileFilter: (_req, file, cb) => {
    const okMime = /^image\/(jpeg|png|webp)$|^application\/pdf$/.test(file.mimetype);
    if (!okMime) return cb(ApiError.badRequest('Only JPG, PNG, WEBP images or PDF files are accepted.'));
    return cb(null, true);
  },
});

function uploadFields(fields) {
  return [
    memoryUpload.fields(fields),
    (err, _req, _res, next) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.badRequest(`File is too large. Maximum size is ${Math.round(env.maxUploadBytes / (1024 * 1024))} MB.`));
      }
      return next(err instanceof ApiError ? err : ApiError.badRequest(err.message || 'Upload failed.'));
    },
  ];
}

function safeName(ext) {
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = crypto.randomBytes(10).toString('hex');
  return `${stamp}-${rand}.${ext}`;
}

/**
 * Validates the magic bytes of an uploaded image (or document) and stores it
 * under UPLOAD_DIR/<category>/. Returns { url, filename, size }.
 * Base64 data URLs are deliberately never persisted in the database.
 */
async function persistUpload(file, { category = 'events', allowPdf = false } = {}) {
  if (!file || !file.buffer || !file.buffer.length) throw ApiError.badRequest('No file received.');
  const allowed = allowPdf ? DOC_TYPES : IMAGE_TYPES;
  const type = await FileType.fromBuffer(file.buffer);
  if (!type || !allowed.has(type.ext)) {
    const hint = allowPdf ? 'JPG, PNG, WEBP or PDF' : 'JPG, PNG or WEBP';
    throw ApiError.badRequest(`That file is not a valid ${hint} file.`);
  }
  const dir = path.join(env.uploadDir, category);
  await fsp.mkdir(dir, { recursive: true });
  const filename = safeName(type.ext);
  const dest = path.join(dir, filename);
  await fsp.writeFile(dest, file.buffer, { mode: 0o644 });
  return { url: `/uploads/${category}/${filename}`, filename, size: file.buffer.length, mime: type.mime };
}

/** Removes a previously stored upload (used when replacing/clearing an image). */
async function removeUpload(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  const rel = url.replace(/^\/uploads\//, '').split('?')[0];
  const abs = path.resolve(env.uploadDir, rel);
  if (!abs.startsWith(path.resolve(env.uploadDir))) return; // path traversal guard
  try { await fsp.unlink(abs); } catch { /* already gone */ }
}

function ensureUploadDirs() {
  for (const sub of ['events', 'brochures', 'site', 'onspot']) {
    fs.mkdirSync(path.join(env.uploadDir, sub), { recursive: true });
  }
}

module.exports = { uploadFields, persistUpload, removeUpload, ensureUploadDirs, IMAGE_TYPES, DOC_TYPES };
