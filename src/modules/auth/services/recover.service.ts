import { Injectable } from "@nestjs/common";
import { origin, json, fail } from "../../workspace/workspace.js";

@Injectable()
export class RecoverService {
  async execute(req: Request) {
    try {
      origin(req);
      return json(
        {
          error:
            "Email recovery is not configured in this local installation. Ask the local operator to run Create-Reset-Link.cmd.",
        },
        503,
      );
    } catch (e) {
      return fail(e);
    }
  }
}
