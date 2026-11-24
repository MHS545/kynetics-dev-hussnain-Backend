import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.module.js";
import { authenticatedUser } from "../session.js";
import { json } from "../../workspace/workspace.js";
@Injectable()
export class AccessService {
  constructor(private readonly database: DatabaseService) {}
  async execute(request: Request) {
    const user = await authenticatedUser(request);
    if (!user) return json({ error: "Sign in to open this workspace." }, 401);
    const { rows } = await this.database.pool.query(
      "SELECT role FROM kynetis.memberships WHERE user_id=$1 UNION ALL SELECT role FROM kynetis.portal_grants WHERE user_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
      [user.id],
    );
    return json({
      user: { id: user.id, email: user.email },
      roles: [...new Set(rows.map((row: { role: string }) => row.role))],
    });
  }
}
