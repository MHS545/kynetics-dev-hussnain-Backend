import type { PasswordLoginDto } from "../dto/password-login.dto.js";
import { Injectable } from "@nestjs/common";
import { database } from "../../../database/database.mjs";
import { signIn } from "../accounts.mjs";
import { sessionCookie } from "../session.js";
import { origin, json, fail, accessForUser } from "../../workspace/workspace.js";
import { insist } from "@kynetis/shared/domain";
import { workspaceSnapshot } from "../../workspace/workspace-response.js";
import { usesFirebase } from "../../../config/firebase-admin.js";

@Injectable()
export class PasswordLoginService {
  async execute(req: Request) {
    try {
      origin(req);
      insist(
        !usesFirebase(),
        "Use Firebase email/password or Google sign-in.",
        403,
      );
      const raw = await req.text();
      insist(raw.length < 8192, "Request too large.", 413);
      const { email, password }: PasswordLoginDto = JSON.parse(raw);
      insist(
        typeof email === "string" &&
          email.length <= 254 &&
          typeof password === "string" &&
          password.length > 0 &&
          password.length <= 1024,
        "Enter your email and password.",
      );
      const { token, user } = await signIn(database(), email, password);
      const snapshot = await workspaceSnapshot(await accessForUser(req, user));
      return json({ ok: true, snapshot }, 200, {
        "Set-Cookie": sessionCookie(req, token),
      });
    } catch (e) {
      return fail(e);
    }
  }
}
