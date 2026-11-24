import {
  Controller,
  Get,
  Req,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { UsersService } from "./users.service.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { webRequest } from "../../common/http/http.js";
import { authenticatedUser } from "../auth/session.js";
@UseGuards(SessionGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get("me") async me(@Req() request: Request) {
    const user = await authenticatedUser(webRequest(request));
    if (!user) throw new UnauthorizedException();
    return this.users.profile(user.id);
  }
}
