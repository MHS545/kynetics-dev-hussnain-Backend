import { Injectable } from "@nestjs/common";
import {
  access,
  origin,
  json,
  fail,
  load,
  commit,
  hash,
} from "../workspace/workspace.js";
import { apply, active, categories, insist } from "@kynetis/shared/domain";
import { evidenceMime, evidenceSizeError } from "@kynetis/shared/evidence";
import { database } from "../../database/database.mjs";
import {
  boundedBytes,
  storeEvidence,
  readEvidence,
} from "./storage/evidence.mjs";
import { workspaceSnapshot } from "../workspace/workspace-response.js";
async function ticketFor(id: unknown, workspace: string, user: string) {
  insist(
    typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id),
    "Invalid upload reservation.",
  );
  const { rows } = await database().query(
    "SELECT * FROM kynetis.uploads WHERE id=$1 AND workspace_id=$2 AND user_id=$3",
    [id, workspace, user],
  );
  insist(rows[0], "Upload reservation not found.", 404);
  return rows[0];
}

@Injectable()
export class FilesService {
  async post(req: Request) {
    try {
      origin(req);
      const context = await access(req),
        { workspace, role, user } = context;
      insist(
        role === "customer",
        "Only the customer may upload evidence.",
        403,
      );
      const text = await req.text();
      insist(text.length < 8192, "Request too large.", 413);
      const p = JSON.parse(text);
      const { state, revision } = await load(workspace);
      if (p.action === "prepare") {
        insist(
          Number.isSafeInteger(p.size) &&
            !evidenceSizeError(p.size, !!p.requestId),
          "Choose a non-empty file within the upload limit.",
          413,
        );
        insist(
          typeof p.name === "string" &&
            p.name.trim() &&
            categories.includes(p.type),
          "Choose a file and category.",
        );
        insist(
          ["application/pdf", "image/jpeg", "image/png"].includes(p.mime),
          "Unsupported document format.",
          415,
        );
        insist(
          p.revision === revision,
          "Workspace changed. Refresh and retry.",
          409,
        );
        const id = crypto.randomUUID(),
          document = {
            id,
            name: p.name.replace(/[\r\n\\/]/g, "_").slice(0, 200),
            type: p.type,
            key: `${workspace}/${id}`,
            hash: "pending",
            mime: p.mime,
            size: p.size,
            status: "PENDING",
            ...(p.requestId ? { requestId: p.requestId } : {}),
          };
        apply(state, role, "upload", { document });
        await database().query(
          "INSERT INTO kynetis.uploads(id,workspace_id,user_id,revision,document) VALUES($1,$2,$3,$4,$5::jsonb)",
          [id, workspace, user.id, revision, JSON.stringify(document)],
        );
        return json({ ticketId: id, uploadUrl: `/api/file?ticket=${id}` });
      }
      insist(p.action === "complete", "Invalid upload operation.");
      const ticket = await ticketFor(p.ticketId, workspace, user.id);
      if (ticket.completed)
        return json({
          ok: true,
          snapshot: await workspaceSnapshot(context, { state, revision }),
        });
      insist(
        Date.parse(ticket.expires_at) > Date.now() &&
          Number(ticket.revision) === revision,
        "Upload expired or workspace changed. Try again.",
        409,
      );
      let bytes;
      try {
        bytes = await readEvidence(ticket.document.key);
      } catch {
        return json(
          { error: "The file upload has not completed. Try again." },
          409,
        );
      }
      const document = ticket.document;
      insist(
        bytes.length === document.size &&
          !evidenceSizeError(bytes.length, !!document.requestId),
        "Uploaded file size does not match.",
        413,
      );
      insist(
        evidenceMime(bytes) === document.mime,
        "Only signature-matching PDF, JPG and PNG files are accepted.",
        415,
      );
      document.hash = await hash(new Uint8Array(bytes).buffer);
      const result = apply(state, role, "upload", { document });
      await commit(
        workspace,
        revision,
        result.state,
        result.operation,
        role,
        result.payload,
        user.id,
        ticket.id,
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
  async put(req: Request) {
    try {
      origin(req);
      const { workspace, role, user } = await access(req);
      insist(role === "customer", "Access denied.", 403);
      const ticket = await ticketFor(
        new URL(req.url).searchParams.get("ticket"),
        workspace,
        user.id,
      );
      insist(
        !ticket.completed && Date.parse(ticket.expires_at) > Date.now(),
        "Upload expired or already completed.",
        409,
      );
      let bytes;
      try {
        bytes = await boundedBytes(req, ticket.document.size);
      } catch {
        return json(
          {
            error:
              "The uploaded file exceeds its reservation or is unreadable.",
          },
          413,
        );
      }
      insist(
        bytes.length === ticket.document.size,
        "File size does not match.",
        413,
      );
      insist(
        evidenceMime(bytes) === ticket.document.mime,
        "Only signature-matching PDF, JPG and PNG files are accepted.",
        415,
      );
      try {
        await storeEvidence(ticket.document.key, bytes);
      } catch (e: any) {
        if (e.code === "EEXIST")
          return json(
            {
              error:
                "This file was already uploaded. Complete the reservation or select it again.",
            },
            409,
          );
        throw e;
      }
      return json({ ok: true });
    } catch (e) {
      return fail(e);
    }
  }
  async get(req: Request) {
    try {
      const { workspace, role } = await access(req);
      insist(
        role === "customer" || role === "compliance_officer",
        "Access denied.",
        403,
      );
      const { state } = await load(workspace);
      insist(role === "customer" || active(state), "Access revoked.", 403);
      const doc = state.documents.find(
        (d) => d.id === new URL(req.url).searchParams.get("id"),
      );
      insist(doc, "File not found.", 404);
      let bytes;
      try {
        bytes = await readEvidence(doc.key);
      } catch {
        return json({ error: "Original file unavailable." }, 404);
      }
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": doc.mime,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (e) {
      return fail(e);
    }
  }
}
