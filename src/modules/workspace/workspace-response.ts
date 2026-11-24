import type { User } from "../auth/session.js";
import type { State } from "@kynetis/shared/domain";
import { redact } from "@kynetis/shared/domain";
import { accessForUser, load, events, json } from "./workspace.js";
import { canPreviewRoles } from "../../config/environment.js";
function sessionSummary(user: User, preview = canPreviewRoles()) {
  return {
    configured: true,
    authenticated: true,
    userId: user.id,
    email: user.email ?? null,
    name:
      [user.user_metadata?.first_name, user.user_metadata?.last_name]
        .filter(Boolean)
        .join(" ") ||
      user.email?.split("@")[0] ||
      "Account",
    preview,
  };
}
export async function workspaceSnapshot(
  context: Awaited<ReturnType<typeof accessForUser>>,
  known?: { state: State; revision: number },
) {
  const { workspace, role, user, preview } = context;
  const common = {
    role,
    preview,
    portalId: context.portalId,
    portalLabel: context.portalLabel,
    portals: context.portals,
    auth: { ...sessionSummary(user), preview },
  };
  if (!role) return common;
  const [{ state, revision }, ledger] = await Promise.all([
    known ?? load(workspace),
    events(workspace),
  ]);
  return {
    ...common,
    state: redact(state, role),
    revision,
    stats: { documents: state.documents.length },
    events: ledger.filter((event: any) => event.revision <= revision),
  };
}
export async function bootstrapResponse(req: Request, user: User) {
  try {
    return json(await workspaceSnapshot(await accessForUser(req, user)));
  } catch (error) {
    return workspaceSetupFailure(user, error);
  }
}
function workspaceSetupFailure(user: User, error: unknown) {
  // A successful sign-in remains distinct from missing database setup.
  const message =
    error instanceof Error && "status" in error
      ? error.message
      : "Workspace unavailable. Please retry.";
  return json(
    { role: null, auth: sessionSummary(user), setupError: message },
    503,
  );
}
