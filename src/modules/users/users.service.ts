import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.module.js";
import {
  connectFirebaseAccount,
  checkLinkAttempts,
} from "./firebase-account.repository.mjs";
import type { FirebaseIdentityDto } from "./dto/firebase-identity.dto.js";
import type { UserProfileDto } from "./dto/user-profile.dto.js";
import type { UserEntity } from "./entities/user.entity.js";
@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}
  connect(
    identity: FirebaseIdentityDto,
    profile: Record<string, unknown>,
    password?: string,
  ) {
    return connectFirebaseAccount(
      this.database.pool,
      identity,
      profile,
      password,
    );
  }
  checkLinkAttempts(uid: string) {
    return checkLinkAttempts(this.database.pool, uid);
  }
  async profile(id: string): Promise<UserProfileDto> {
    const { rows } = await this.database.pool.query(
      "SELECT id,email,metadata,active,created_at FROM kynetis.users WHERE id=$1 AND active=true",
      [id],
    );
    const row = rows[0] as UserEntity | undefined;
    if (!row) throw new NotFoundException("Account unavailable.");
    const text = (key: string) =>
      typeof row.metadata[key] === "string"
        ? (row.metadata[key] as string)
        : "";
    return {
      id: row.id,
      email: row.email,
      firstName: text("first_name"),
      lastName: text("last_name"),
      nationality: text("nationality"),
    };
  }
}
