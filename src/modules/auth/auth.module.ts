import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { UsersModule } from "../users/users.module.js";
import { FirebaseLoginService } from "./services/firebase-login.service.js";
import { PasswordLoginService } from "./services/password-login.service.js";
import { RegisterService } from "./services/register.service.js";
import { LogoutService } from "./services/logout.service.js";
import { SessionInfoService } from "./services/session-info.service.js";
import { RecoverService } from "./services/recover.service.js";
import { ResetValidationService } from "./services/reset-validation.service.js";
import { PasswordResetService } from "./services/password-reset.service.js";
import { CompletionService } from "./services/completion.service.js";
import { AccessService } from "./services/access.service.js";
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionGuard,
    FirebaseLoginService,
    PasswordLoginService,
    RegisterService,
    LogoutService,
    SessionInfoService,
    RecoverService,
    ResetValidationService,
    PasswordResetService,
    CompletionService,
    AccessService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
