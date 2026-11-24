import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { WorkspaceService } from "./workspace.service.js";
import { send, webRequest } from "../../common/http/http.js";
@Controller("workspace")
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}
  @Get()
  snapshot(@Req() req: Request, @Res() res: Response) {
    return send(res, this.service.get(webRequest(req)));
  }
  @Post()
  change(@Req() req: Request, @Res() res: Response) {
    return send(res, this.service.post(webRequest(req)));
  }
}
