import { Injectable } from "@nestjs/common";
import { access, origin, json, fail, load, commit, hash } from "./workspace.js";
import { apply, insist } from "@kynetis/shared/domain";
import { publicConfiguration } from "../../config/environment.js";
import { authenticatedUser } from "../auth/session.js";
import { bootstrapResponse, workspaceSnapshot } from "./workspace-response.js";

@Injectable()
export class WorkspaceService {
  async get(req: Request) {
    const config = publicConfiguration();
    if (!config.configured)
      return json(
        { role: null, auth: { configured: false, authenticated: false } },
        503,
      );
    try {
      const user = await authenticatedUser(req);
      if (!user)
        return json(
          {
            role: null,
            auth: { configured: true, authenticated: false },
            error: "Sign in to open this workspace.",
          },
          401,
        );
      return bootstrapResponse(req, user);
    } catch (error) {
      return fail(error);
    }
  }
  async post(req: Request) {
    try {
      origin(req);
      const context = await access(req);
      const { workspace, role, user, preview } = context;
      const body = await req.text();
      insist(body.length <= 131072, "Request too large.", 413);
      let p: any;
      try {
        p = JSON.parse(body);
      } catch {
        return json({ error: "Invalid JSON request." }, 400);
      }
      insist(
        p && typeof p === "object" && !Array.isArray(p),
        "Invalid request.",
      );
      if (p.action === "role") {
        const selected = context.portals.find((item) =>
          p.portalId ? item.id === p.portalId : item.role === p.role,
        );
        insist(
          preview || selected,
          "Your account does not have access to this portal. Ask your administrator for access.",
          403,
        );
        insist(
          ["customer", "compliance_officer", "admin"].includes(
            p.role ?? selected?.role,
          ),
          "Invalid portal.",
        );
        const next = preview
          ? { ...context, role: p.role }
          : {
              ...context,
              role: selected!.role,
              workspace: selected!.workspace,
              portalId: selected!.id,
              portalLabel: selected!.label,
            };
        const cookie = preview
          ? `kynetis_v2_demo_role=${p.role}`
          : `kynetis_v2_portal=${selected!.id}`;
        return json(
          { ok: true, snapshot: await workspaceSnapshot(next) },
          200,
          {
            "Set-Cookie": `${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`,
          },
        );
      }
      insist(role, "Choose a demonstration role.", 401);
      insist(p.action !== "upload", "Use the file endpoint.");
      const { state, revision } = await load(workspace);
      insist(
        revision === p.revision,
        "Workspace changed. Refresh and retry.",
        409,
      );
      const result = apply(state, role, p.action, {
        ...p,
        actorId: user.id,
        actorName:
          user.user_metadata?.full_name || user.email || "Institution officer",
      });
      if (result.state.review.decision && !result.state.review.decision.hash)
        result.state.review.decision.hash = await hash(
          JSON.stringify({ ...result.state.review.decision, hash: undefined }),
        );
      await commit(
        workspace,
        revision,
        result.state,
        result.operation,
        role,
        result.payload,
        user.id,
      );
      return json({
        ok: true,
        snapshot: await workspaceSnapshot(context, {
          state: result.state,
          revision: revision + 1,
        }),
      });
    } catch (e) {
      return fail(e);
    }
  }
}
