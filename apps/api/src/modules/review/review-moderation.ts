/**
 * Automated pre-publication checks (M6.2). Reviews that trip one go to the moderation queue as
 * PENDING (`AUTO_FLAGGED`) instead of publishing; everything else publishes immediately.
 */
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.(?:com|in|net|org|io|xyz)\b/i;
const CONTACT = /\b[6-9]\d{9}\b|\b[\w.+-]+@[\w-]+\.[\w.]+\b/;
const BLOCKED = ['scam site', 'whatsapp me', 'call me', 'fuck', 'shit', 'bastard', 'chutiya'];

/** Reports at or above this send a published review back to the queue. */
export const REPORT_THRESHOLD = 3;

export function autoFlagReason(text: string): string | null {
  if (LINK.test(text)) return 'AUTO_FLAGGED: contains a link';
  if (CONTACT.test(text)) return 'AUTO_FLAGGED: contains contact details';
  const lower = text.toLowerCase();
  if (BLOCKED.some((w) => lower.includes(w))) return 'AUTO_FLAGGED: blocked words';
  return null;
}

/** "Asha Verma" → "Asha V."; empty names get a generic label. */
export function displayName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ShopSphere Customer';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
