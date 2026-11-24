import { Injectable } from "@nestjs/common";
import { database } from "../../../database/database.mjs";
import { validReset } from "../accounts.mjs";
import { json } from "../../workspace/workspace.js";

@Injectable()
export class ResetValidationService {
  async execute(req: Request) {
    try {
      return json({
        valid: await validReset(
          database(),
          new URL(req.url).searchParams.get("token"),
        ),
      });
    } catch {
      return json({ valid: false });
    }
  }
}
