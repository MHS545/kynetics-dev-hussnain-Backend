import { UsersService } from "../../users/users.service.js";
import type { FirebaseLoginDto } from "../dto/firebase-login.dto.js";
import { Injectable } from "@nestjs/common";
import { firebaseAdmin, usesFirebase } from "../../../config/firebase-admin.js";
import { firebaseConfig } from "../../../config/firebase-config.js";
import { origin, json, fail, accessForUser } from "../../workspace/workspace.js";
import { workspaceSnapshot } from "../../workspace/workspace-response.js";
import { sessionCookie } from "../session.js";
import {
  registrationErrors,
  profileFromRegistration,
  type Registration,
} from "@kynetis/shared/registration";
import { insist } from "@kynetis/shared/domain";
import type { DecodedIdToken } from "firebase-admin/auth";

@Injectable()
export class FirebaseLoginService {
  constructor(private readonly users: UsersService) {}
  async execute(request: Request) {
    try {
      insist(
        request.headers.has("origin"),
        "Cross-origin mutation refused.",
        403,
      );
      origin(request);
      insist(
        usesFirebase(),
        "Firebase sign-in is not enabled for this server.",
        503,
      );
      const raw = await request.text();
      insist(raw.length < 32768, "Request too large.", 413);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return json({ error: "Invalid JSON request." }, 400);
      }
      insist(
        payload && typeof payload === "object" && !Array.isArray(payload),
        "Invalid sign-in request.",
      );
      const { idToken, profile, existingPassword }: FirebaseLoginDto = payload;
      insist(
        typeof idToken === "string" && idToken.length < 16384,
        "Sign in with Firebase first.",
        401,
      );
      insist(
        existingPassword === undefined ||
          (typeof existingPassword === "string" &&
            existingPassword.length <= 1024),
        "Invalid account-link request.",
      );
      let claims: DecodedIdToken;
      try {
        claims = await firebaseAdmin().verifyIdToken(idToken, true);
      } catch {
        return json(
          {
            error:
              "Firebase sign-in could not be verified. Sign in again, or ask your operator to check the Firebase server credentials.",
          },
          401,
        );
      }
      const age = Date.now() / 1000 - claims.auth_time;
      insist(
        age >= -60 && age < 300,
        "Please sign in again before opening a session.",
        401,
      );
      insist(
        ["password", "google.com"].includes(claims.firebase.sign_in_provider),
        "Use email/password or Google sign-in.",
        403,
      );
      insist(typeof claims.email === "string", "An email address is required.");
      let metadata = {};
      if (profile !== undefined) {
        insist(
          profile && typeof profile === "object" && !Array.isArray(profile),
          "Invalid profile.",
        );
        const value: Registration = {
          ...profile,
          email: claims.email,
          password: "validation-only",
          confirmPassword: "validation-only",
        };
        const fields = registrationErrors(value);
        if (Object.keys(fields).length)
          return json({ error: "Check your profile details.", fields }, 400);
        metadata = profileFromRegistration(value);
      }
      if (existingPassword !== undefined)
        await this.users.checkLinkAttempts(claims.uid);
      const cookie = await firebaseAdmin().createSessionCookie(idToken, {
        expiresIn: 8 * 60 * 60 * 1000,
      });
      const user = await this.users.connect(
        {
          projectId: firebaseConfig.projectId,
          uid: claims.uid,
          email: claims.email,
          name: claims.name,
        },
        metadata,
        existingPassword,
      );
      const snapshot = await workspaceSnapshot(
        await accessForUser(request, user),
      );
      return json(
        {
          snapshot,
          kycId: "state" in snapshot ? snapshot.state.profile.kyc : undefined,
        },
        200,
        { "Set-Cookie": sessionCookie(request, cookie) },
      );
    } catch (error) {
      if ((error as { code?: string })?.code === "ACCOUNT_LINK_REQUIRED")
        return json(
          { code: "ACCOUNT_LINK_REQUIRED", error: (error as Error).message },
          409,
        );
      return fail(error);
    }
  }
}
