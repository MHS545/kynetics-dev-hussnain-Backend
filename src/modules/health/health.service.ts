import { Injectable } from "@nestjs/common";
import { dbStatus } from "../../database/database.mjs";
import { publicConfiguration } from "../../config/environment.js";
import { json } from "../workspace/workspace.js";

@Injectable()
export class HealthService {
  async get() {
    try {
      if (!publicConfiguration().configured)
        return json(
          {
            application: "Kynetis",
            configured: false,
            databaseConnected: false,
          },
          503,
        );
      return json({
        application: "Kynetis",
        runtime: "nestjs-node",
        backend: "postgresql",
        configured: true,
        ...(await dbStatus()),
        setup:
          "Run backend/src/database/migrations/01_kynetis_schema.sql manually in pgAdmin if schemaReady is false.",
      });
    } catch {
      return json(
        {
          application: "Kynetis",
          configured: true,
          databaseConnected: false,
          error:
            "Cannot connect to PostgreSQL. Check DB settings and the external Docker network.",
        },
        503,
      );
    }
  }
}
