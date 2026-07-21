import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  int,
  bigint,
  boolean,
  timestamp,
  json,
  decimal,
} from "drizzle-orm/mysql-core";

// ── Auth (provided by backend-building auth feature) ─────────────────────────

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── XP Architect schema (Build doc §5) ───────────────────────────────────────

export const projects = mysqlTable("projects", {
  id: serial("id").primaryKey(),
  ownerId: bigint("owner_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  clientName: varchar("client_name", { length: 255 }),
  scopeText: text("scope_text").notNull(),
  budget: varchar("budget", { length: 255 }),
  timeline: varchar("timeline", { length: 255 }),
  teamSize: varchar("team_size", { length: 255 }),
  constraintsText: text("constraints_text"),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  llmEndpointJson: json("llm_endpoint_json"), // BYO-endpoint config (§9.3 tier 2)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Project = typeof projects.$inferSelect;

export const projectRoleProfiles = mysqlTable("project_role_profiles", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => projects.id),
  profile: mysqlEnum("profile", ["SA", "PM"]).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type ProjectRoleProfile = typeof projectRoleProfiles.$inferSelect;

export const stakeholders = mysqlTable("stakeholders", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => projects.id),
  name: varchar("name", { length: 255 }).notNull(),
  roleTitle: varchar("role_title", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(), // required (Q2 amended)
  inviteToken: varchar("invite_token", { length: 255 }).notNull().unique(),
  invitedAt: timestamp("invited_at").defaultNow().notNull(),
  inviteExpiresAt: timestamp("invite_expires_at"), // invited_at + 30 days
  lastActivityAt: timestamp("last_activity_at"), // drives stall detection + nudges
  nudgeCount: int("nudge_count").default(0).notNull(), // capped at 3 (Q2)
  lastNudgeAt: timestamp("last_nudge_at"), // one nudge per 3 days max
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Stakeholder = typeof stakeholders.$inferSelect;

export const SESSION_STATES = [
  "INVITED",
  "ASSESSMENT_IN_PROGRESS",
  "ASSESSMENT_COMPLETE",
  "DISCOVERY_IN_PROGRESS",
  "DISCOVERY_COMPLETE",
  "REVIEW_IN_PROGRESS",
  "COMPLETED",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const stakeholderSessions = mysqlTable("stakeholder_sessions", {
  id: serial("id").primaryKey(),
  stakeholderId: bigint("stakeholder_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => stakeholders.id),
  state: mysqlEnum("state", SESSION_STATES).default("INVITED").notNull(),
  currentPhase: int("current_phase"), // 1..4 during DISCOVERY_IN_PROGRESS
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type StakeholderSession = typeof stakeholderSessions.$inferSelect;

export const assessmentResults = mysqlTable("assessment_results", {
  id: serial("id").primaryKey(),
  sessionId: bigint("session_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => stakeholderSessions.id),
  primaryStyle: mysqlEnum("primary_style", [
    "detail_oriented",
    "big_picture",
    "story_narrative",
    "problem_solving",
  ]).notNull(),
  secondaryStyle: mysqlEnum("secondary_style", [
    "detail_oriented",
    "big_picture",
    "story_narrative",
    "problem_solving",
  ]),
  confidence: decimal("confidence", { precision: 4, scale: 3 }), // 0.000–1.000
  method: mysqlEnum("method", ["conversational", "form"]).notNull(),
  transcriptJson: json("transcript_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type AssessmentResult = typeof assessmentResults.$inferSelect;

export const conversationMessages = mysqlTable("conversation_messages", {
  id: serial("id").primaryKey(),
  sessionId: bigint("session_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => stakeholderSessions.id),
  stage: mysqlEnum("stage", ["assessment", "discovery", "review"]).notNull(),
  phase: int("phase"), // 1..4 when stage = discovery
  role: mysqlEnum("role", ["agent", "stakeholder"]).notNull(),
  content: text("content").notNull(),
  flagsJson: json("flags_json"), // inline scope flags on agent messages
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type ConversationMessage = typeof conversationMessages.$inferSelect;

export const phaseSummaries = mysqlTable("phase_summaries", {
  id: serial("id").primaryKey(),
  sessionId: bigint("session_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => stakeholderSessions.id),
  phase: int("phase").notNull(),
  summary: text("summary").notNull(),
  approved: boolean("approved").default(false).notNull(),
  stakeholderFeedback: text("stakeholder_feedback"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type PhaseSummary = typeof phaseSummaries.$inferSelect;

export const discoveryFlags = mysqlTable("discovery_flags", {
  id: serial("id").primaryKey(),
  sessionId: bigint("session_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => stakeholderSessions.id),
  phase: int("phase"),
  type: mysqlEnum("type", ["out_of_scope", "scope_drift", "inconsistency"]).notNull(),
  severity: mysqlEnum("severity", ["low", "medium", "high"]).notNull(),
  text: text("text").notNull(),
  status: mysqlEnum("status", ["open", "resolved"]).default("open").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type DiscoveryFlag = typeof discoveryFlags.$inferSelect;

export const agentHandoffs = mysqlTable("agent_handoffs", {
  id: serial("id").primaryKey(),
  sessionId: bigint("session_id", { mode: "number", unsigned: true }).references(
    () => stakeholderSessions.id,
  ),
  projectId: bigint("project_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => projects.id),
  fromAgent: varchar("from_agent", { length: 64 }).notNull(),
  toAgent: varchar("to_agent", { length: 64 }).notNull(),
  contextJson: json("context_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type AgentHandoff = typeof agentHandoffs.$inferSelect;

export const compilerAlerts = mysqlTable("compiler_alerts", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => projects.id),
  sessionId: bigint("session_id", { mode: "number", unsigned: true }).references(
    () => stakeholderSessions.id,
  ),
  type: mysqlEnum("type", ["risk", "scope_creep", "contradiction", "coverage_gap"]).notNull(),
  severity: mysqlEnum("severity", ["low", "medium", "high"]).notNull(),
  message: text("message").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CompilerAlert = typeof compilerAlerts.$inferSelect;

export const compiledReports = mysqlTable("compiled_reports", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => projects.id),
  version: int("version").notNull(),
  datasetJson: json("dataset_json").notNull(), // §6.4 unified compiled dataset
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type CompiledReport = typeof compiledReports.$inferSelect;

export const deliverables = mysqlTable("deliverables", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => projects.id),
  profile: mysqlEnum("profile", ["SA", "PM"]).notNull(),
  templateId: varchar("template_id", { length: 64 }).notNull().default("sdd"), // §6.5 template (SA: sdd; PM: pm_charter/pm_plan/pm_risk_register/pm_stakeholder_map)
  version: int("version").default(1).notNull(),
  status: mysqlEnum("status", ["draft", "in_review", "approved"])
    .default("draft")
    .notNull(),
  contentMd: text("content_md"),
  crossRoleNotesMd: text("cross_role_notes_md"),
  feedbackLogJson: json("feedback_log_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Deliverable = typeof deliverables.$inferSelect;

export const purchases = mysqlTable("purchases", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => projects.id),
  profile: mysqlEnum("profile", ["SA", "PM", "SA_PM_BUNDLE"]).notNull(),
  stripeSessionId: varchar("stripe_session_id", { length: 255 }),
  stripePaymentIntent: varchar("stripe_payment_intent", { length: 255 }),
  status: mysqlEnum("status", ["pending", "paid", "refunded"])
    .default("pending")
    .notNull(),
  amountCents: int("amount_cents"),
  currency: varchar("currency", { length: 8 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export type Purchase = typeof purchases.$inferSelect;

export const emailLogs = mysqlTable("email_logs", {
  id: serial("id").primaryKey(),
  stakeholderId: bigint("stakeholder_id", { mode: "number", unsigned: true }).references(
    () => stakeholders.id,
  ),
  projectId: bigint("project_id", { mode: "number", unsigned: true }).references(
    () => projects.id,
  ),
  type: mysqlEnum("type", ["invite", "nudge", "milestone", "magic_link"]).notNull(),
  toAddress: varchar("to_address", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  status: mysqlEnum("status", ["sent", "failed", "dev_logged"]).notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});
export type EmailLog = typeof emailLogs.$inferSelect;

/** Owner magic-link sign-in tokens (§2 amendment): single-use, 15 min, hashed at rest. */
export const magicTokens = mysqlTable("magic_tokens", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(), // sha256 hex — raw token never stored
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type MagicToken = typeof magicTokens.$inferSelect;

export const llmCallLogs = mysqlTable("llm_call_logs", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true }).references(
    () => projects.id,
  ),
  sessionId: bigint("session_id", { mode: "number", unsigned: true }).references(
    () => stakeholderSessions.id,
  ),
  agent: varchar("agent", { length: 64 }).notNull(),
  purpose: varchar("purpose", { length: 255 }).notNull(),
  model: varchar("model", { length: 255 }),
  inputTokens: int("input_tokens"),
  outputTokens: int("output_tokens"),
  latencyMs: int("latency_ms"),
  // Metadata only — prompt/response content is never logged by default (§4.3).
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type LlmCallLog = typeof llmCallLogs.$inferSelect;
