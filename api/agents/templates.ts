/**
 * Deliverable templates (§6.5, v6 amendment): templates as DATA — a fixed
 * section skeleton plus per-section guidance. Live mode generates section by
 * section; dev mode fills deterministically from the compiled dataset.
 * This structure is what later lets enterprise customers supply house templates.
 */

export type TemplateId = "sdd" | "pm_charter" | "pm_plan" | "pm_risk_register" | "pm_stakeholder_map";
export type TemplateProfile = "SA" | "PM";

export interface TemplateSection {
  heading: string;
  /** Live-mode instruction for the model writing this section. */
  guidance: string;
}

export interface DeliverableTemplate {
  id: TemplateId;
  profile: TemplateProfile;
  name: string;
  description: string;
  sections: TemplateSection[];
}

export const TEMPLATES: DeliverableTemplate[] = [
  {
    id: "sdd",
    profile: "SA",
    name: "Solution Design Document",
    description: "The Solution Architect's design record — current state, requirements, proposed architecture, and the risk picture.",
    sections: [
      { heading: "1. Executive Overview", guidance: "The engagement in technical terms: what is being built, for whom, and the one-sentence design thesis." },
      { heading: "2. Current State Understanding", guidance: "Systems, processes, and pain points as discovered from stakeholders. Name the stakeholders behind each major point." },
      { heading: "3. Requirements Summary", guidance: "Functional and non-functional requirements grounded in the compiled patterns. Group by theme; note support strength." },
      { heading: "4. Proposed Solution Architecture", guidance: "Components, integrations, and data flows that satisfy the requirements within the stated constraints. Mark inference explicitly." },
      { heading: "5. Integration & Data Considerations", guidance: "Integration surfaces, data migration concerns, and technical dependencies. Tie to coverage gaps where relevant." },
      { heading: "6. Out-of-Scope Register", guidance: "The ranked out-of-scope list with recommendations — what was excluded and why." },
      { heading: "7. Open Questions & Assumptions", guidance: "Unresolved contradictions as open questions; explicit assumptions requiring validation." },
      { heading: "8. Risks & Mitigations", guidance: "Technical risks from the compiled data, each with a concrete mitigation." },
    ],
  },
  {
    id: "pm_charter",
    profile: "PM",
    name: "Project Charter",
    description: "Authorizes the project — objectives, success criteria, scope boundaries, and stakeholder authority.",
    sections: [
      { heading: "1. Purpose & Authorization", guidance: "Why this project exists and on whose authority, drawn from the engagement context." },
      { heading: "2. Objectives & Success Criteria", guidance: "Measurable objectives as stated by stakeholders; how success will be judged." },
      { heading: "3. Scope Statement", guidance: "In scope per the scope boundary; out of scope per the compiled register." },
      { heading: "4. Key Stakeholders & Authority", guidance: "The stakeholder list with roles; identify decision authority from the material." },
      { heading: "5. High-Level Milestones", guidance: "Major checkpoints implied by constraints and discovery material. Mark inference explicitly." },
    ],
  },
  {
    id: "pm_plan",
    profile: "PM",
    name: "Project Management Plan",
    description: "How delivery will run — phasing, dependencies, constraints, and the working cadence.",
    sections: [
      { heading: "1. Delivery Approach", guidance: "The phasing strategy suited to this engagement given constraints and stakeholder availability." },
      { heading: "2. Phases & Milestones", guidance: "Proposed phase breakdown with entry/exit criteria. Mark inference explicitly." },
      { heading: "3. Dependencies", guidance: "External and internal dependencies, including unresolved coverage gaps that gate progress." },
      { heading: "4. Constraints", guidance: "Budget, timeline, and resource constraints as stated, with their delivery implications." },
      { heading: "5. Cadence & Governance", guidance: "Status rhythm, decision forums, and escalation path appropriate to the stakeholder map." },
    ],
  },
  {
    id: "pm_risk_register",
    profile: "PM",
    name: "Risk Register",
    description: "Ranked delivery risks drawn from contradictions, coverage gaps, and recurring concern patterns.",
    sections: [
      { heading: "1. Top Risks", guidance: "Ranked risk list. Each: description, source (contradiction/gap/pattern), likelihood, impact, severity." },
      { heading: "2. Mitigations & Owners", guidance: "Concrete mitigation per risk with a suggested owner role." },
      { heading: "3. Watch Items", guidance: "Lower-severity signals to monitor — early indicators and trigger conditions." },
    ],
  },
  {
    id: "pm_stakeholder_map",
    profile: "PM",
    name: "Stakeholder & Communications Map",
    description: "Who's who, what each cares about, and how to engage them through delivery.",
    sections: [
      { heading: "1. Stakeholder Register", guidance: "Each stakeholder: role, coverage completed, their dominant concerns from the material." },
      { heading: "2. Influence & Alignment", guidance: "Alignment assessment — where stakeholders agree (patterns) and disagree (contradictions), with engagement implications." },
      { heading: "3. Communications Approach", guidance: "Per-stakeholder engagement recommendations: channel, cadence, and what to keep them informed about." },
    ],
  },
];

export function templateById(id: TemplateId): DeliverableTemplate {
  const t = TEMPLATES.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}
