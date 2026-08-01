import type { TriageLevel } from "@/generated/prisma/enums";

import {
  EMERGENCY_OVERRIDES,
  SYMPTOM_RULES,
  type SymptomRuleData,
} from "../data/symptom-rules";

/**
 * Deterministic fallback assistant.
 *
 * This runs whenever Ollama is unreachable, too slow, or disabled. It is not a
 * degraded toy: for the two things patients actually need — "which specialist
 * do I need?" and "is this an emergency?" — a curated rule set is arguably
 * *safer* than a small local model, because its behaviour is auditable and it
 * cannot hallucinate a reassuring answer to a dangerous symptom.
 *
 * Matching is intentionally biased toward escalation. A phrase that could be
 * read two ways resolves to the higher triage level.
 */

export interface TriageOutcome {
  triageLevel: TriageLevel;
  suggestedSpecialty: string | null;
  advice: string;
  matchedKeywords: string[];
  confidence: "high" | "medium" | "low";
}

const TRIAGE_ORDER: Record<TriageLevel, number> = {
  SELF_CARE: 0,
  ROUTINE: 1,
  URGENT: 2,
  EMERGENCY: 3,
};

const EMERGENCY_ADVICE =
  "Based on what you have described, this may need emergency care. Please call your local emergency number or go to the nearest emergency department now. Do not wait for an appointment.";

/** Normalises for matching: lowercase, collapse whitespace, strip punctuation. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Negation guard. "no chest pain" must not trigger the cardiac emergency rule,
 * which is the single most common false positive in keyword triage.
 */
function isNegated(haystack: string, keyword: string): boolean {
  const index = haystack.indexOf(keyword);
  if (index === -1) return false;

  const preceding = haystack.slice(Math.max(0, index - 24), index);
  return /\b(no|not|without|never|denies|deny|don't|doesn't|didn't)\s+(\w+\s+){0,2}$/.test(
    preceding,
  );
}

export function matchSymptomRules(
  text: string,
  rules: SymptomRuleData[] = SYMPTOM_RULES,
): { rule: SymptomRuleData; matched: string[] }[] {
  const haystack = normalise(text);

  const hits: { rule: SymptomRuleData; matched: string[] }[] = [];

  for (const rule of rules) {
    const matched = rule.keywords
      .map(normalise)
      .filter((keyword) => haystack.includes(keyword) && !isNegated(haystack, keyword));

    if (matched.length > 0) hits.push({ rule, matched });
  }

  return hits.sort((a, b) => b.rule.priority - a.rule.priority);
}

export function triage(text: string, rules: SymptomRuleData[] = SYMPTOM_RULES): TriageOutcome {
  const haystack = normalise(text);

  const override = EMERGENCY_OVERRIDES.map(normalise).find(
    (phrase) => haystack.includes(phrase) && !isNegated(haystack, phrase),
  );

  if (override) {
    return {
      triageLevel: "EMERGENCY",
      suggestedSpecialty: null,
      advice: EMERGENCY_ADVICE,
      matchedKeywords: [override],
      confidence: "high",
    };
  }

  const hits = matchSymptomRules(text, rules);

  if (hits.length === 0) {
    return {
      triageLevel: "ROUTINE",
      suggestedSpecialty: "Internal Medicine",
      advice:
        "I could not match that to a specific specialty. A general physician is the right starting point — they can examine you and refer you onward if needed. If your symptoms are severe or getting worse quickly, seek urgent care instead.",
      matchedKeywords: [],
      confidence: "low",
    };
  }

  const top = hits[0];
  if (!top) throw new Error("unreachable: hits verified non-empty");

  // The highest triage level across *all* matches wins, even if the specialty
  // comes from the highest-priority rule. Mentioning chest pain alongside a
  // rash must not be downgraded to a dermatology appointment.
  const highest = hits.reduce(
    (worst, hit) =>
      TRIAGE_ORDER[hit.rule.triageLevel] > TRIAGE_ORDER[worst.rule.triageLevel] ? hit : worst,
    top,
  );

  const confidence: TriageOutcome["confidence"] =
    top.matched.length > 1 || top.rule.priority >= 70
      ? "high"
      : hits.length > 1
        ? "medium"
        : "low";

  return {
    triageLevel: highest.rule.triageLevel,
    suggestedSpecialty: highest.rule.specialty ?? top.rule.specialty,
    advice: highest.rule.advice,
    matchedKeywords: [...new Set(hits.flatMap((hit) => hit.matched))],
    confidence,
  };
}

/**
 * Canned answers for questions about using the platform itself.
 *
 * Stems end in `\w*`, not `\b`: `\breschedul\b` can never match "reschedule",
 * because a word boundary cannot fall between two letters. The same applies to
 * every inflected form ("consultation", "credentials", "records").
 */
const FAQ: { patterns: RegExp; answer: string }[] = [
  {
    patterns: /\b(how (do i )?book\w*|make an appointment|booking process)\b/,
    answer:
      "Search for a doctor, open their profile, then pick a time from the availability panel. Your slot is held for 10 minutes while you confirm, so nobody can take it mid-booking. You will get a confirmation with a reference code once payment completes.",
  },
  {
    patterns: /\b(cancel\w*|refund\w*|money back)\b/,
    answer:
      "You can cancel from your appointments page. Cancel more than 24 hours before the start time and you are refunded in full automatically. If the doctor cancels, you are always refunded regardless of timing.",
  },
  {
    patterns: /\b(reschedul\w*|change (the )?(time|date)|move my appointment)\b/,
    answer:
      "Open the appointment and choose Reschedule. You can move to any open slot with the same doctor, and your original payment carries across — you will not be charged twice.",
  },
  {
    patterns: /\b(video|online|telehealth|remote)\s+(consult\w*|appointment\w*|call\w*)\b/,
    answer:
      "Many doctors offer video consultations — look for the Video badge on their profile. A join link appears on your appointment page, and the room opens 10 minutes before the start time.",
  },
  {
    patterns: /\b(cost\w*|fee\w*|pric\w*|how much|charge\w*)\b/,
    answer:
      "Fees are set by each doctor and shown on their profile before you book, split by consultation type. There are no booking fees on top, and you can filter the directory by maximum fee.",
  },
  {
    patterns: /\b(verif\w*|credential\w*|licen[cs]\w*|trust\w*)\b/,
    answer:
      "Every doctor submits their medical licence, degree and identity documents, which an administrator reviews before the profile goes live. Only approved doctors appear in search results.",
  },
  {
    patterns: /\b(record\w*|report\w*|upload\w*|test result\w*)\b/,
    answer:
      "You can upload reports from your records page. They stay private to you until you explicitly share them with a doctor for a specific appointment.",
  },
];

export function answerFaq(text: string): string | null {
  const haystack = normalise(text);
  return FAQ.find((entry) => entry.patterns.test(haystack))?.answer ?? null;
}

const DISCLAIMER =
  "This is general information, not a medical diagnosis. Always confirm with a qualified doctor.";

/**
 * Produces the full assistant reply offline: FAQ answer if the question is
 * about the platform, otherwise a triage response.
 */
export function fallbackReply(text: string): { content: string; outcome: TriageOutcome | null } {
  const faq = answerFaq(text);
  if (faq) return { content: faq, outcome: null };

  const outcome = triage(text);

  const parts: string[] = [];

  if (outcome.triageLevel === "EMERGENCY") {
    parts.push(`**This may be an emergency.**\n\n${outcome.advice}`);
  } else {
    parts.push(outcome.advice);

    if (outcome.suggestedSpecialty) {
      const urgency =
        outcome.triageLevel === "URGENT"
          ? "I would not leave this more than a day or two."
          : "This is not urgent, so book at a time that suits you.";
      parts.push(
        `Based on what you have described, **${outcome.suggestedSpecialty}** is the right specialty. ${urgency}`,
      );
      parts.push(
        `You can [see ${outcome.suggestedSpecialty} doctors](/doctors?specialty=${encodeURIComponent(outcome.suggestedSpecialty)}) and compare availability.`,
      );
    }

    parts.push(`_${DISCLAIMER}_`);
  }

  return { content: parts.join("\n\n"), outcome };
}
