import { Injectable } from "@nestjs/common";
import { authenticatedUser } from "../session.js";
import { publicConfiguration } from "../../../config/environment.js";
import { json, fail } from "../../workspace/workspace.js";

@Injectable()
export class SessionInfoService {
  async execute(req: Request) {
    try {
      const config = publicConfiguration();
      if (!config.configured) return json({ ...config, authenticated: false });
      const user = await authenticatedUser(req);
      return json({
        ...config,
        authenticated: !!user,
        userId: user?.id ?? null,
        email: user?.email ?? null,
        preview: false,
      });
    } catch (e) {
      return fail(e);
    }
  }
}
