import type { RegisterDto } from "../dto/register.dto.js";
import { Injectable } from "@nestjs/common";
import { database } from "../../../database/database.mjs";
import { usesFirebase } from "../../../config/firebase-admin.js";
import { registerAccount, throttle } from "../accounts.mjs";
import {
  origin,
  json,
  fail,
  accessForUser,
  load,
} from "../../workspace/workspace.js";
import { insist } from "@kynetis/shared/domain";
import {
  registrationErrors,
  profileFromRegistration,
} from "@kynetis/shared/registration";

@Injectable()
export class RegisterService {
  async execute(req: Request) {
    try {
      origin(req);
      insist(
        !usesFirebase(),
        "Create your account using Firebase registration.",
        403,
      );
      const raw = await req.text();
      insist(raw.length < 32768, "Request too large.", 413);
      const value: RegisterDto = JSON.parse(raw),
        fields = registrationErrors(value);
      if (Object.keys(fields).length)
        return json({ error: "Check the highlighted fields.", fields }, 400);
      const db = database();
      await throttle(db, "register:" + value.email.trim().toLowerCase());
      const user = await registerAccount(db, {
        email: value.email,
        password: value.password,
        metadata: profileFromRegistration(value),
      });
      const context = await accessForUser(req, user),
        { state } = await load(context.workspace);
      return json(
        { ok: true, status: "created", kycId: state.profile.kyc },
        201,
      );
    } catch (e) {
      return fail(e);
    }
  }
}
