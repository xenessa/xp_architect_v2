import { authRouter } from "./auth-router";
import { projectsRouter } from "./projects-router";
import { stakeholdersRouter } from "./stakeholders-router";
import { sessionRouter } from "./session-router";
import { compilerRouter } from "./compiler-router";
import { billingRouter } from "./billing-router";
import { teamRouter } from "./team-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  projects: projectsRouter,
  stakeholders: stakeholdersRouter,
  session: sessionRouter,
  compiler: compilerRouter,
  billing: billingRouter,
  team: teamRouter,
});

export type AppRouter = typeof appRouter;
