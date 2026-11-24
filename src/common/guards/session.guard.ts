import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { authenticatedUser } from "../../modules/auth/session.js";
import { webRequest } from "../http/http.js";
@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const user = await authenticatedUser(
      webRequest(context.switchToHttp().getRequest()),
    );
    if (!user) throw new UnauthorizedException();
    return true;
  }
}
