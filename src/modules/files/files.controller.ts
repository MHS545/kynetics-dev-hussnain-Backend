import { Controller, Get, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { FilesService } from "./files.service.js";
import { send, webRequest } from "../../common/http/http.js";
@Controller("file")
export class FilesController {
  constructor(private readonly service: FilesService) {}
  @Get()
  download(@Req() req: Request, @Res() res: Response) {
    return send(res, this.service.get(webRequest(req)));
  }
  @Post()
  reserveOrComplete(@Req() req: Request, @Res() res: Response) {
    return send(res, this.service.post(webRequest(req)));
  }
  @Put()
  upload(@Req() req: Request, @Res() res: Response) {
    return send(res, this.service.put(webRequest(req)));
  }
}
