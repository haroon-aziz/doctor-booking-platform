import type { TriageLevel } from "@/generated/prisma/enums";

/**
 * The canonical triage rule set.
 *
 * This is the single source shared by the database seed and the offline
 * fallback engine, so the rules the assistant applies without a database are
 * identical to the ones an administrator later edits in the admin panel.
 *
 * Clinical stance: these rules route a patient to the right kind of clinician
 * and flag emergencies. They never diagnose. When wording is ambiguous the
 * rules escalate rather than reassure — the cost of over-triage is an
 * unnecessary appointment; the cost of under-triage can be a death.
 */

export interface SymptomRuleData {
  keywords: string[];
  specialty: string | null;
  triageLevel: TriageLevel;
  advice: string;
  /** Higher wins when several rules match. Emergencies sit at 100. */
  priority: number;
}

export const SYMPTOM_RULES: SymptomRuleData[] = [
  {
    keywords: [
      "chest pain",
      "chest tightness",
      "crushing chest",
      "pain radiating to arm",
      "heart attack",
      "pressure in chest",
    ],
    specialty: "Cardiology",
    triageLevel: "EMERGENCY",
    advice:
      "Chest pain can be a sign of a heart attack. Stop what you are doing and seek emergency care immediately — call your local emergency number. Do not drive yourself and do not wait for an appointment.",
    priority: 100,
  },
  {
    keywords: [
      "difficulty breathing",
      "shortness of breath",
      "cannot breathe",
      "can't breathe",
      "breathless",
      "gasping",
      "choking",
    ],
    specialty: "Pulmonology",
    triageLevel: "EMERGENCY",
    advice:
      "Severe difficulty breathing needs emergency assessment now. Call your local emergency number immediately.",
    priority: 100,
  },
  {
    keywords: [
      "stroke",
      "face drooping",
      "slurred speech",
      "weakness on one side",
      "numbness on one side",
      "sudden confusion",
    ],
    specialty: "Neurology",
    triageLevel: "EMERGENCY",
    advice:
      "These are stroke warning signs. Every minute matters — call emergency services immediately. Note the time symptoms began, as treatment depends on it.",
    priority: 100,
  },
  {
    keywords: ["severe bleeding", "uncontrolled bleeding", "coughing blood", "vomiting blood"],
    specialty: null,
    triageLevel: "EMERGENCY",
    advice:
      "Apply firm direct pressure to any wound and seek emergency care immediately.",
    priority: 100,
  },
  {
    keywords: ["suicidal", "self harm", "want to die", "end my life", "kill myself"],
    specialty: "Psychiatry",
    triageLevel: "EMERGENCY",
    advice:
      "You deserve immediate support. Please contact your local emergency number or a crisis helpline right now, or go to the nearest emergency department. If someone is with you, tell them how you are feeling.",
    priority: 100,
  },
  {
    keywords: ["unconscious", "fainted", "seizure", "fitting", "convulsion"],
    specialty: "Neurology",
    triageLevel: "EMERGENCY",
    advice:
      "Loss of consciousness or a seizure needs emergency assessment. Call emergency services now.",
    priority: 100,
  },
  {
    keywords: ["child fever", "baby cough", "infant not feeding", "baby not feeding", "newborn fever"],
    specialty: "Paediatrics",
    triageLevel: "URGENT",
    advice:
      "Young children can deteriorate quickly. Arrange a paediatric review promptly, and seek emergency care if the child is floppy, will not feed, or has a rash that does not fade under pressure.",
    priority: 85,
  },
  {
    keywords: ["palpitations", "irregular heartbeat", "racing heart", "high blood pressure"],
    specialty: "Cardiology",
    triageLevel: "URGENT",
    advice:
      "Cardiac symptoms should be reviewed promptly. Book with a cardiologist in the next day or two, and seek emergency care if you also develop chest pain, breathlessness or fainting.",
    priority: 80,
  },
  {
    keywords: ["severe headache", "worst headache", "thunderclap headache", "headache with vision loss"],
    specialty: "Neurology",
    triageLevel: "URGENT",
    advice:
      "A sudden, severe headache warrants prompt neurological assessment. If it came on instantly and is the worst you have ever had, treat it as an emergency.",
    priority: 75,
  },
  {
    keywords: ["blurred vision", "eye pain", "red eye", "vision loss", "sudden vision"],
    specialty: "Ophthalmology",
    triageLevel: "URGENT",
    advice: "Sudden vision changes need prompt eye assessment to protect your sight.",
    priority: 70,
  },
  {
    keywords: ["persistent fever", "fever for a week", "high fever", "fever won't go"],
    specialty: "Internal Medicine",
    triageLevel: "URGENT",
    advice:
      "A fever lasting more than a few days should be assessed by a physician soon, particularly with a rash, stiff neck or confusion.",
    priority: 70,
  },
  {
    keywords: ["severe abdominal pain", "stomach pain severe", "appendix", "abdominal pain"],
    specialty: "Gastroenterology",
    triageLevel: "URGENT",
    advice:
      "Significant abdominal pain should be assessed promptly, especially if it is localised to the lower right, or comes with fever or vomiting.",
    priority: 65,
  },
  {
    keywords: ["pregnant", "pregnancy", "bleeding in pregnancy", "morning sickness"],
    specialty: "Obstetrics",
    triageLevel: "URGENT",
    advice:
      "Pregnancy-related symptoms should be reviewed by an obstetrician. Any bleeding or severe pain during pregnancy needs same-day assessment.",
    priority: 60,
  },
  {
    keywords: ["anxiety", "depression", "panic attack", "cannot sleep", "low mood", "stressed"],
    specialty: "Psychiatry",
    triageLevel: "ROUTINE",
    advice:
      "Speaking to a mental health professional genuinely helps. Video consultations are available and confidential, and sessions are unhurried.",
    priority: 45,
  },
  {
    keywords: ["joint pain", "knee pain", "back pain", "shoulder pain", "sprain", "fracture"],
    specialty: "Orthopaedics",
    triageLevel: "ROUTINE",
    advice:
      "Persistent joint or back pain should be assessed by an orthopaedic specialist, who can arrange imaging if needed.",
    priority: 40,
  },
  {
    keywords: ["rash", "itchy skin", "acne", "eczema", "psoriasis", "skin discoloration", "mole"],
    specialty: "Dermatology",
    triageLevel: "ROUTINE",
    advice:
      "Skin complaints suit a video consultation well — clear, well-lit photographs usually let treatment start the same day.",
    priority: 40,
  },
  {
    keywords: ["diabetes", "blood sugar", "thyroid", "hormone"],
    specialty: "Endocrinology",
    triageLevel: "ROUTINE",
    advice:
      "Metabolic and hormonal symptoms are best reviewed by an endocrinologist, usually alongside blood tests.",
    priority: 38,
  },
  {
    keywords: ["sore throat", "ear pain", "blocked nose", "sinus", "tonsils", "hearing loss"],
    specialty: "ENT",
    triageLevel: "ROUTINE",
    advice:
      "An ENT specialist can assess this. Many such cases settle with simple treatment.",
    priority: 35,
  },
  {
    keywords: ["period", "menstrual", "pcos", "irregular periods", "contraception"],
    specialty: "Gynaecology",
    triageLevel: "ROUTINE",
    advice: "A gynaecologist can investigate this and discuss the options available to you.",
    priority: 35,
  },
  {
    keywords: ["weight gain", "weight loss", "diet", "nutrition", "obesity"],
    specialty: "Nutrition",
    triageLevel: "ROUTINE",
    advice:
      "A clinical nutritionist can build a plan around your metabolic profile rather than a generic diet.",
    priority: 25,
  },
  {
    keywords: ["common cold", "runny nose", "mild cough", "sneezing", "sore muscles"],
    specialty: "Internal Medicine",
    triageLevel: "SELF_CARE",
    advice:
      "This usually settles within a week with rest and fluids. See a doctor if it worsens, if you become breathless, or if it persists beyond ten days.",
    priority: 10,
  },
];

/** Phrases that always force an emergency response regardless of context. */
export const EMERGENCY_OVERRIDES = [
  "emergency",
  "ambulance",
  "dying",
  "collapsed",
  "not breathing",
  "no pulse",
];
