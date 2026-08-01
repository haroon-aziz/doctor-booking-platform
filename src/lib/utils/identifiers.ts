import { customAlphabet } from "nanoid";

/**
 * Human-facing identifiers.
 *
 * The alphabet excludes characters that are ambiguous when read aloud or
 * transcribed from a printout (0/O, 1/I/L) — these codes end up on invoices and
 * get quoted over the phone to a clinic receptionist.
 */
const UNAMBIGUOUS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const shortCode = customAlphabet(UNAMBIGUOUS, 8);
const ticketCode = customAlphabet(UNAMBIGUOUS, 6);

export function appointmentReference(): string {
  return `APT-${shortCode()}`;
}

export function invoiceNumber(sequence: number, date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `INV-${year}${month}-${sequence.toString().padStart(6, "0")}`;
}

export function ticketNumber(): string {
  return `TKT-${ticketCode()}`;
}

export function videoRoomName(appointmentId: string): string {
  return `consult-${appointmentId.slice(-10)}-${shortCode().toLowerCase()}`;
}

/** URL-safe slug with a short suffix guaranteeing uniqueness across doctors. */
export function slugify(input: string, suffix = true): string {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const safeBase = base.length > 0 ? base : "profile";
  return suffix ? `${safeBase}-${shortCode().toLowerCase().slice(0, 5)}` : safeBase;
}
