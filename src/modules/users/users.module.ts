import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
@Module({
  controllers: [UsersController],
  providers: [UsersService, SessionGuard],
  exports: [UsersService],
})
export class UsersModule {}
