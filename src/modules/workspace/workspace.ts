import { initialCustomerState } from "./customer-profile.js";
import { State, Role, insist, DomainError } from "@kynetis/shared/domain";
import type { PortalAccess } from "@kynetis/shared/workspace";
import { authenticatedUser, type User } from "../auth/session.js";
import { database } from "../../database/database.mjs";
import { canPreviewRoles, missingEnvironment } from "../../config/environment.js";
export async function access(req: Request) {
  insist(
    missingEnvironment().length === 0,
    "Configure the database connection before signing in.",
    503,
  );
  const user = await authenticatedUser(req);
  insist(user, "Sign in to open this workspace.", 401);
  return accessForUser(req, user);
}
// Only call with a verified user resolved to an active PostgreSQL account.
// Login endpoints reuse their verified user without a second session lookup.
export async function accessForUser(req: Request, user: User) {
  let data: any;
  try {
    const result = await database().query(
      "SELECT kynetis.bootstrap($1,$2::jsonb) AS data",
      [user.id, JSON.stringify(initialCustomerState(user))],
    );
    data = result.rows[0]?.data;
  } catch {
    throw new DomainError(
      "Database setup is incomplete. Run backend/src/database/migrations/01_kynetis_schema.sql manually in pgAdmin.",
      503,
    );
  }
  insist(data, "Workspace could not be opened.", 503);
  const membership = data as {
    workspace: string;
    role: Role;
    portals?: PortalAccess[];
  };
  const portals = membership.portals ?? [
    {
      id: "primary",
      workspace: membership.workspace,
      role: membership.role,
      label: "Personal workspace",
    },
  ];
  const preview = canPreviewRoles() && membership.workspace === user.id;
  const choice = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("kynetis_v2_demo_role="))
    ?.split("=")[1];
  const role = preview
    ? ["customer", "compliance_officer", "admin"].includes(choice ?? "")
      ? (choice as Role)
      : null
    : membership.role;
  const requestedPortal =
    req.headers.get("x-kynetis-portal") ??
    (req.headers.get("cookie") ?? "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("kynetis_v2_portal="))
      ?.slice("kynetis_v2_portal=".length);
  const selected = portals.find((p) => p.id === requestedPortal) ?? portals[0];
  return {
    workspace: preview ? membership.workspace : selected.workspace,
    role: preview ? role : selected.role,
    user,
    preview,
    portals,
    portalId: preview ? "preview" : selected.id,
    portalLabel: preview ? "Review workspace" : selected.label,
  };
}
export function origin(req: Request) {
  const value = req.headers.get("origin");
  if (!value && /^Bearer\s+\S+$/i.test(req.headers.get("authorization") ?? ""))
    return;
  let valid = false;
  try {
    const supplied = new URL(value ?? ""),
      target = new URL(req.url);
    // Browser mutations must come from the explicitly configured frontend.
    const allowed = new URL(process.env.APP_ORIGIN || target.origin);
    valid = supplied.origin === allowed.origin;
  } catch {}

  insist(valid, "Cross-origin mutation refused.", 403);
}
export const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
      ...headers,
    },
  });
export function fail(error: unknown) {
  const expected =
    error instanceof DomainError ||
    (error instanceof Error && error.name === "AccountError");
  if (
    (error as any)?.code === "42P01" ||
    (error as any)?.code === "3F000" ||
    (error as any)?.code === "42883"
  )
    return json(
      {
        error:
          "Run backend/src/database/migrations/01_kynetis_schema.sql manually in pgAdmin, then refresh.",
      },
      503,
    );
  if (!expected)
    console.error(
      "Kynetis request failed; inspect configuration and provider availability.",
    );
  return json(
    {
      error: expected
        ? (error as any).message
        : "Operation failed. Refresh and retry.",
    },
    expected ? (error as any).status : 500,
  );
}
export async function hash(value: string | ArrayBuffer) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export async function load(id: string) {
  const { rows } = await database().query(
    "SELECT state,revision FROM kynetis.workspaces WHERE id=$1",
    [id],
  );
  insist(rows[0], "Workspace unavailable.", 503);
  return { state: rows[0].state as State, revision: Number(rows[0].revision) };
}
export async function events(id: string) {
  const { rows } = await database().query(
    "SELECT * FROM kynetis.events WHERE workspace_id=$1 ORDER BY revision DESC LIMIT 500",
    [id],
  );
  return rows.map((event: any) => ({
    ...event,
    revision: Number(event.revision),
    payload: JSON.stringify(event.payload),
  }));
}
export async function commit(
  id: string,
  rev: number,
  state: State,
  operation: string,
  actor: string,
  payload: unknown,
  userId: string,
  uploadId?: string,
) {
  const { rows } = await database().query(
    "SELECT digest FROM kynetis.events WHERE workspace_id=$1 ORDER BY revision DESC LIMIT 1",
    [id],
  );
  const eventId = crypto.randomUUID(),
    at = new Date().toISOString(),
    previous = rows[0]?.digest ?? "GENESIS";
  const digest = await hash(
    JSON.stringify({
      id: eventId,
      workspace: id,
      revision: rev + 1,
      operation,
      actor,
      actorUserId: userId,
      at,
      payload,
      previousHash: previous,
    }),
  );
  try {
    await database().query(
      "SELECT kynetis.commit($1,$2,$3::jsonb,$4::jsonb,$5,$6)",
      [
        id,
        rev,
        JSON.stringify(state),
        JSON.stringify({
          id: eventId,
          operation,
          actor,
          created_at: at,
          payload,
          previous_hash: previous,
          digest,
        }),
        userId,
        uploadId ?? null,
      ],
    );
  } catch (e: any) {
    if (["40001", "23505"].includes(e.code))
      throw new DomainError(
        "Workspace changed or upload expired. Refresh and retry.",
        409,
      );
    throw e;
  }
}
