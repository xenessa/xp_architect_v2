import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Privacy & data handling (build doc §9, Q7) — public page.
 * Subprocessor list, retention/deletion commitments, DPA terms.
 */
export default function Privacy() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy & Data Handling</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How XP Architect processes discovery data, who processes it on our behalf, and the
          commitments we make about retention and deletion.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model privacy posture</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            Discovery conversations are processed by large language models. Our default posture
            (tier 1) uses a managed model API under <strong>no-training / zero-retention</strong>
            terms: your content is never used to train models and is not retained by the provider
            after the response is generated.
          </p>
          <p>
            Enterprise customers on tier 2 can point any project at their own
            OpenAI-compatible model endpoint (BYO endpoint). When configured, that project's LLM
            traffic goes directly to the customer's endpoint and no content transits our default
            provider.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subprocessors</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              <strong>LLM API provider</strong> — processes conversation content to run the
              assessment, discovery, compiler, and deliverable agents, under no-training /
              zero-retention terms. (Tier 2: replaced by the customer's own endpoint.)
            </li>
            <li>
              <strong>Transactional email provider (Resend)</strong> — recipient address and email
              content for invites, nudges, and milestone notices.
            </li>
            <li>
              <strong>Stripe</strong> — payment processing. Card details never touch XP Architect
              servers; we receive payment status and amount only.
            </li>
            <li>
              <strong>Cloud hosting provider</strong> — application hosting and the MySQL database
              that stores project data.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retention, logging & deletion</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              LLM and email logs contain <strong>metadata only</strong> — timestamps, token
              counts, latency, recipient address — never message content.
            </li>
            <li>
              Deleting a project <strong>cascades to every related row</strong>: sessions,
              messages, compiled reports, deliverables, purchases, and logs.
            </li>
            <li>Stakeholder invite links expire 30 days after issue and are regeneratable.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Processing Addendum</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            For customers requiring a DPA, we process stakeholder personal data (name, role,
            email, conversation content) solely to provide the discovery service, on the
            controller's documented instructions, with the subprocessor list above. To execute a
            DPA or ask about our posture, contact your XP Architect account representative.
          </p>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <Link to="/" className="underline underline-offset-4">
          ← Back to dashboard
        </Link>
      </p>
    </div>
  );
}
