import { Injectable } from "@nestjs/common";
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
// One clear entry point for authentication operations; each operation stays readable.
@Injectable()
export class AuthService {
  constructor(
    private readonly firebase: FirebaseLoginService,
    private readonly password: PasswordLoginService,
    private readonly registration: RegisterService,
    private readonly logout: LogoutService,
    private readonly session: SessionInfoService,
    private readonly recover: RecoverService,
    private readonly resetValidation: ResetValidationService,
    private readonly reset: PasswordResetService,
    private readonly completion: CompletionService,
    private readonly access: AccessService,
  ) {}
  firebaseLogin(request: Request) {
    return this.firebase.execute(request);
  }
  passwordLogin(request: Request) {
    return this.password.execute(request);
  }
  register(request: Request) {
    return this.registration.execute(request);
  }
  signOut(request: Request) {
    return this.logout.execute(request);
  }
  sessionInfo(request: Request) {
    return this.session.execute(request);
  }
  recoveryEmail(request: Request) {
    return this.recover.execute(request);
  }
  validateReset(request: Request) {
    return this.resetValidation.execute(request);
  }
  resetPassword(request: Request) {
    return this.reset.execute(request);
  }
  accountCompletion(request: Request) {
    return this.completion.execute(request);
  }
  pageAccess(request: Request) {
    return this.access.execute(request);
  }
}
