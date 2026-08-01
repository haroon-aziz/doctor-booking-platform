import { describe, expect, it } from "vitest";

import {
  applyFixedDiscount,
  applyPercentageDiscount,
  formatMoney,
  fromMinorUnits,
  minorUnitFactor,
  splitPlatformFee,
  toMinorUnits,
} from "@/lib/utils/money";

describe("money", () => {
  it("round-trips through minor units", () => {
    expect(toMinorUnits(3500, "PKR")).toBe(350_000);
    expect(fromMinorUnits(350_000, "PKR")).toBe(3500);
  });

  it("uses a factor of one for zero-decimal currencies", () => {
    expect(minorUnitFactor("JPY")).toBe(1);
    expect(minorUnitFactor("PKR")).toBe(100);
    expect(toMinorUnits(5000, "JPY")).toBe(5000);
  });

  it("rejects a non-finite amount rather than storing NaN", () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow(TypeError);
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("avoids the float error that plagues naive money maths", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; integers sidestep it.
    expect(toMinorUnits(0.1) + toMinorUnits(0.2)).toBe(toMinorUnits(0.3));
  });

  describe("discounts", () => {
    it("applies a percentage", () => {
      expect(applyPercentageDiscount(350_000, 20)).toBe(70_000);
    });

    it("respects a maximum discount cap", () => {
      expect(applyPercentageDiscount(350_000, 20, 50_000)).toBe(50_000);
    });

    it("never discounts more than the amount itself", () => {
      expect(applyPercentageDiscount(10_000, 150)).toBe(10_000);
      expect(applyFixedDiscount(10_000, 99_999)).toBe(10_000);
    });

    it("never produces a negative discount", () => {
      expect(applyFixedDiscount(10_000, -500)).toBe(0);
      expect(applyPercentageDiscount(10_000, -20)).toBe(0);
    });
  });

  describe("platform fee split", () => {
    it("splits without creating or destroying value", () => {
      for (const amount of [100_000, 333_333, 1, 7, 999_999]) {
        const { platformFeeMinor, doctorPayoutMinor } = splitPlatformFee(amount, 12);
        expect(platformFeeMinor + doctorPayoutMinor).toBe(amount);
      }
    });

    it("gives the doctor the remainder on an uneven split", () => {
      const { platformFeeMinor, doctorPayoutMinor } = splitPlatformFee(333_333, 12);
      expect(platformFeeMinor).toBe(40_000);
      expect(doctorPayoutMinor).toBe(293_333);
    });
  });

  it("formats using the currency's own conventions", () => {
    const formatted = formatMoney(350_000, "PKR", "en-PK");
    expect(formatted).toContain("3,500");
  });
});
