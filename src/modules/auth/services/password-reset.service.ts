import type { ResetPasswordDto } from "../dto/reset-password.dto.js";
import { Injectable } from "@nestjs/common";
import { database } from "../../../database/database.mjs";
import { usesFirebase } from "../../../config/firebase-admin.js";
import { resetPassword } from "../accounts.mjs";
import { sessionCookie } from "../session.js";
import { origin, json, fail } from "../../workspace/workspace.js";
import { insist } from "@kynetis/shared/domain";

@Injectable()
export class PasswordResetService {
  async execute(req: Request) {
    let client;
    try {
      origin(req);
      insist(
        !usesFirebase(),
        "Reset your password using the link emailed by Firebase.",
        403,
      );
      const raw = await req.text();
      insist(raw.length < 8192, "Request too large.", 413);
      const { token, password, confirmPassword }: ResetPasswordDto =
        JSON.parse(raw);
      insist(
        typeof password === "string" &&
          password.length >= 8 &&
          password.length <= 1024,
        "Use at least 8 characters.",
      );
      insist(password === confirmPassword, "The passwords do not match.");
      client = await database().connect();
      await resetPassword(client, token, password);
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(req, "", true),
      });
    } catch (e) {
      return fail(e);
    } finally {
      client?.release();
    }
  }
}
