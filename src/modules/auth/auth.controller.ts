import { Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { send, webRequest } from "../../common/http/http.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuthService } from "./auth.service.js";
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("firebase")
  firebaseLogin(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.firebaseLogin(webRequest(request)));
  }
  @Post("login")
  passwordLogin(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.passwordLogin(webRequest(request)));
  }
  @Post("register")
  register(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.register(webRequest(request)));
  }
  @Post("logout")
  signOut(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.signOut(webRequest(request)));
  }
  @Get("session")
  sessionInfo(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.sessionInfo(webRequest(request)));
  }
  @Post("recover")
  recoveryEmail(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.recoveryEmail(webRequest(request)));
  }
  @Get("recovery")
  validateReset(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.validateReset(webRequest(request)));
  }
  @Post("password")
  resetPassword(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.resetPassword(webRequest(request)));
  }
  @UseGuards(SessionGuard)
  @Get("completion")
  accountCompletion(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.accountCompletion(webRequest(request)));
  }
  @UseGuards(SessionGuard)
  @Get("access")
  pageAccess(@Req() request: Request, @Res() response: Response) {
    return send(response, this.auth.pageAccess(webRequest(request)));
  }
}
