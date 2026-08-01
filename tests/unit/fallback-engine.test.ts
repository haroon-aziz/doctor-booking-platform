import { describe, expect, it } from "vitest";

import {
  answerFaq,
  fallbackReply,
  triage,
} from "@/features/ai/services/fallback-engine";

describe("offline triage engine", () => {
  describe("emergencies", () => {
    it("flags cardiac symptoms", () => {
      const outcome = triage("I have crushing chest pain and pain radiating to arm");
      expect(outcome.triageLevel).toBe("EMERGENCY");
      expect(outcome.suggestedSpecialty).toBe("Cardiology");
    });

    it("flags stroke signs", () => {
      expect(triage("my father has face drooping and slurred speech").triageLevel).toBe(
        "EMERGENCY",
      );
    });

    it("flags breathing difficulty", () => {
      expect(triage("I cannot breathe properly").triageLevel).toBe("EMERGENCY");
    });

    it("responds compassionately to suicidal ideation", () => {
      const outcome = triage("I have been having thoughts that I want to die");
      expect(outcome.triageLevel).toBe("EMERGENCY");
      expect(outcome.advice.toLowerCase()).toContain("crisis");
    });

    it("escalates on an override phrase regardless of specialty", () => {
      expect(triage("my friend collapsed and is not breathing").triageLevel).toBe("EMERGENCY");
    });
  });

  describe("negation handling", () => {
    /**
     * The most common false positive in keyword triage: a patient ruling a
     * symptom out must not trigger the emergency rule for it.
     */
    it("does not flag an emergency when the symptom is denied", () => {
      expect(triage("I have a rash but no chest pain").triageLevel).not.toBe("EMERGENCY");
      expect(triage("cough without difficulty breathing").triageLevel).not.toBe("EMERGENCY");
    });

    it("still routes the genuine symptom in a negated sentence", () => {
      expect(triage("I have a rash but no chest pain").suggestedSpecialty).toBe("Dermatology");
    });

    it("does not over-apply negation to a later positive mention", () => {
      // The denial attaches to the nearby phrase only.
      expect(triage("no fever, but I have crushing chest pain").triageLevel).toBe("EMERGENCY");
    });
  });

  describe("escalation across multiple matches", () => {
    it("takes the highest triage level, not the first match", () => {
      // A routine skin complaint mentioned alongside cardiac symptoms must not
      // be downgraded to a dermatology appointment.
      const outcome = triage("I have an itchy rash and also chest tightness");
      expect(outcome.triageLevel).toBe("EMERGENCY");
    });
  });

  describe("routine routing", () => {
    it("routes skin complaints to dermatology", () => {
      const outcome = triage("I have had eczema on my hands for months");
      expect(outcome.suggestedSpecialty).toBe("Dermatology");
      expect(outcome.triageLevel).toBe("ROUTINE");
    });

    it("routes mental health to psychiatry", () => {
      expect(triage("I have panic attacks and low mood").suggestedSpecialty).toBe("Psychiatry");
    });

    it("marks a mild cold as self care", () => {
      expect(triage("runny nose and sneezing since yesterday").triageLevel).toBe("SELF_CARE");
    });

    it("escalates paediatric fever above a routine complaint", () => {
      expect(triage("my baby has a fever, child fever since last night").triageLevel).toBe(
        "URGENT",
      );
    });
  });

  describe("unmatched input", () => {
    it("falls back to a general physician without pretending to know", () => {
      const outcome = triage("something feels a bit off lately");
      expect(outcome.suggestedSpecialty).toBe("Internal Medicine");
      expect(outcome.confidence).toBe("low");
      expect(outcome.matchedKeywords).toEqual([]);
    });
  });

  describe("platform FAQ", () => {
    it("answers booking questions", () => {
      expect(answerFaq("how do I book an appointment?")).toContain("availability panel");
    });

    it("answers cancellation questions", () => {
      expect(answerFaq("can I get a refund if I cancel?")).toContain("24 hours");
    });

    it("returns null for a clinical question", () => {
      expect(answerFaq("I have a sore throat")).toBeNull();
    });
  });

  describe("composed reply", () => {
    it("leads with the emergency warning and omits the soft disclaimer", () => {
      const { content } = fallbackReply("severe chest pain");
      expect(content).toContain("**This may be an emergency.**");
      expect(content).not.toContain("book at a time that suits you");
    });

    it("links to the matching specialty for a routine complaint", () => {
      const { content } = fallbackReply("itchy rash on my arm");
      expect(content).toContain("/doctors?specialty=Dermatology");
      expect(content).toContain("not a medical diagnosis");
    });

    it("prefers a platform answer over triage when the question is about booking", () => {
      const { content, outcome } = fallbackReply("how do I reschedule?");
      expect(outcome).toBeNull();
      expect(content).toContain("Reschedule");
    });
  });
});
