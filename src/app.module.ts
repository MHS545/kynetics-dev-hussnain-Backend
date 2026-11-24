import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { WorkspaceModule } from "./modules/workspace/workspace.module.js";
import { FilesModule } from "./modules/files/files.module.js";
import { HealthModule } from "./modules/health/health.module.js";
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    WorkspaceModule,
    FilesModule,
    HealthModule,
  ],
})
export class AppModule {}
