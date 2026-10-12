'use strict';
const prisma = require('./prisma');

/**
 * Writes an audit trail entry. Never store passwords, QR tokens or full
 * student records — only the admin, the action, the entity and light metadata.
 */
async function audit({ adminId = null, action, entityType, entityId = null, metadata = null, ip = null, tx = null }) {
  const client = tx || prisma;
  try {
    await client.auditLog.create({
      data: {
        adminId: adminId || null,
        action,
        entityType,
        entityId: entityId ? String(entityId) : null,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
        ip: ip || null,
      },
    });
  } catch (err) {
    // Auditing must never break the user-facing operation.
    console.error('[audit] failed to write log:', err.message);
  }
}

module.exports = { audit };
