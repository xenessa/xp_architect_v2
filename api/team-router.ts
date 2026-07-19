import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { assertProjectOwner } from "./queries/projects";
import { getEntitlement } from "./billing-router";
import { generateDeliverable } from "./agents/team";
import { deliverables, compiledReports, projects } from "@db/schema";

/**
 * Team Agent API (§6.5, §10.4): deliverable generation (gated by paid
 * entitlement + compiled dataset), review status flow, .docx export (Q3).
 */
export const teamRouter = createRouter({
  /** Latest deliverables + entitlement + compiler state for the tab. */
  getDeliverables: authedQuery
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      const db = getDb();

      const docs = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.projectId, input.projectId))
        .orderBy(desc(deliverables.profile), desc(deliverables.version));

      const [report] = await db
        .select({ version: compiledReports.version })
        .from(compiledReports)
        .where(eq(compiledReports.projectId, input.projectId))
        .orderBy(desc(compiledReports.version))
        .limit(1);

      const entitlement = await getEntitlement(input.projectId);
      return { deliverables: docs, entitlement, compiledReportVersion: report?.version ?? null };
    }),

  /** Generate (or regenerate) a deliverable. Requires entitlement + compiler run. */
  generate: authedQuery
    .input(z.object({ projectId: z.number(), profile: z.enum(["SA", "PM"]) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectOwner(input.projectId, ctx.user.id);
      const entitlement = await getEntitlement(input.projectId);
      const allowed = input.profile === "SA" ? entitlement.sa : entitlement.pm;
      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `The ${input.profile} profile isn't unlocked for this project — purchase it first.`,
        });
      }
      return generateDeliverable(input.projectId, input.profile);
    }),

  /** Advance review status: draft → in_review → approved. */
  updateStatus: authedQuery
    .input(
      z.object({
        deliverableId: z.number(),
        status: z.enum(["draft", "in_review", "approved"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [doc] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, input.deliverableId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Deliverable not found" });
      await assertProjectOwner(doc.projectId, ctx.user.id);
      await db
        .update(deliverables)
        .set({ status: input.status })
        .where(eq(deliverables.id, input.deliverableId));
      return { ok: true };
    }),

  /** Export a deliverable as a formatted .docx download (Q3). */
  downloadDocx: authedQuery
    .input(z.object({ deliverableId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [doc] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, input.deliverableId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Deliverable not found" });
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, doc.projectId))
        .limit(1);
      await assertProjectOwner(doc.projectId, ctx.user.id);

      const buffer = await buildDocx(
        doc.contentMd ?? "",
        doc.crossRoleNotesMd,
        `${project?.name ?? "Project"} · ${doc.profile} profile · v${doc.version}`,
      );
      const safeName = (project?.name ?? "project").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      return {
        filename: `xp-architect-${doc.profile.toLowerCase()}-${safeName}-v${doc.version}.docx`,
        base64: buffer.toString("base64"),
      };
    }),
});

/** Minimal markdown → docx renderer (input is our own generated markdown). */
export async function buildDocx(
  contentMd: string,
  crossRoleNotesMd: string | null,
  footerLine: string,
): Promise<Buffer> {
  const children: Paragraph[] = [];

  const inlineRuns = (text: string): TextRun[] =>
    text
      .split(/\*\*(.+?)\*\*/g)
      .filter((p) => p.length > 0)
      .map((part, i) => new TextRun({ text: part, bold: i % 2 === 1 }));

  const renderBlock = (md: string) => {
    for (const raw of md.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (line.startsWith("### ")) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: inlineRuns(line.slice(4)) }));
      } else if (line.startsWith("## ")) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: inlineRuns(line.slice(3)) }));
      } else if (line.startsWith("# ")) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: inlineRuns(line.slice(2)) }));
      } else if (line.startsWith("- ")) {
        children.push(
          new Paragraph({ bullet: { level: 0 }, children: inlineRuns(line.slice(2)) }),
        );
      } else if (line.startsWith("> ")) {
        children.push(
          new Paragraph({
            indent: { left: 400 },
            children: [new TextRun({ text: line.slice(2), italics: true, color: "555555" })],
          }),
        );
      } else {
        children.push(new Paragraph({ children: inlineRuns(line) }));
      }
    }
  };

  renderBlock(contentMd);
  if (crossRoleNotesMd) {
    children.push(new Paragraph({ children: [] }));
    renderBlock(crossRoleNotesMd);
  }
  children.push(new Paragraph({ children: [] }));
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Generated by XP Architect — ${footerLine}`, size: 18, color: "888888" })],
    }),
  );

  const docx = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(docx);
}
