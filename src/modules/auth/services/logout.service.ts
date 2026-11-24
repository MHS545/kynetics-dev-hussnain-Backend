import { Injectable } from "@nestjs/common";
import { database } from "../../../database/database.mjs";
import { signOut } from "../accounts.mjs";
import { sessionToken, sessionCookie } from "../session.js";
import { origin, json, fail } from "../../workspace/workspace.js";
import { usesFirebase } from "../../../config/firebase-admin.js";

@Injectable()
export class LogoutService {
  async execute(req: Request) {
    try {
      origin(req);
      if (!usesFirebase()) await signOut(database(), sessionToken(req));
      const response = json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(req, "", true),
      });
      for (const name of ["kynetis_v2_portal", "kynetis_v2_demo_role"])
        response.headers.append(
          "Set-Cookie",
          `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
        );
      return response;
    } catch (e) {
      return fail(e);
    }
  }
}
