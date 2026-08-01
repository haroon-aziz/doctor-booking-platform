/**
 * Money handling.
 *
 * Every monetary value in this codebase is an integer in the currency's minor
 * unit (paisa for PKR, cents for USD). Floats are never used for money, and
 * Prisma's Decimal is avoided because it does not survive the React Server
 * Component serialisation boundary.
 */

export const DEFAULT_CURRENCY = "PKR";

/** Currencies whose minor unit is not 1/100 of the major unit. */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function minorUnitFactor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

export function toMinorUnits(amount: number, currency = DEFAULT_CURRENCY): number {
  if (!Number.isFinite(amount)) {
    throw new TypeError(`Cannot convert non-finite amount "${amount}" to minor units.`);
  }
  return Math.round(amount * minorUnitFactor(currency));
}

export function fromMinorUnits(minor: number, currency = DEFAULT_CURRENCY): number {
  return minor / minorUnitFactor(currency);
}

export function formatMoney(
  minor: number,
  currency = DEFAULT_CURRENCY,
  locale = "en-PK",
): string {
  const factor = minorUnitFactor(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: factor === 1 ? 0 : 2,
    maximumFractionDigits: factor === 1 ? 0 : 2,
  }).format(minor / factor);
}

/**
 * Applies a percentage discount using integer arithmetic.
 * Rounds half-up on the discount, which favours the patient by at most 1 paisa.
 */
export function applyPercentageDiscount(
  amountMinor: number,
  percentage: number,
  maxDiscountMinor?: number | null,
): number {
  const raw = Math.round((amountMinor * percentage) / 100);
  const capped = maxDiscountMinor != null ? Math.min(raw, maxDiscountMinor) : raw;
  return clampDiscount(capped, amountMinor);
}

export function applyFixedDiscount(amountMinor: number, discountMinor: number): number {
  return clampDiscount(discountMinor, amountMinor);
}

/** A discount can never be negative, nor exceed the amount being discounted. */
function clampDiscount(discountMinor: number, amountMinor: number): number {
  return Math.max(0, Math.min(discountMinor, amountMinor));
}

/**
 * Splits an amount between the platform and the doctor.
 * The doctor receives the remainder so the two parts always sum exactly to the
 * original — no paisa is created or destroyed by rounding.
 */
export function splitPlatformFee(
  amountMinor: number,
  platformFeePercentage: number,
): { platformFeeMinor: number; doctorPayoutMinor: number } {
  const platformFeeMinor = Math.round((amountMinor * platformFeePercentage) / 100);
  return {
    platformFeeMinor,
    doctorPayoutMinor: amountMinor - platformFeeMinor,
  };
}
