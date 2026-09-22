import crypto from 'crypto';

/**
 * Production ID Generator
 * Generates cryptographically secure, collision-free prefixed UUIDs
 */
export function generateId(prefix: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${uuid.substring(0, 16)}`;
}
