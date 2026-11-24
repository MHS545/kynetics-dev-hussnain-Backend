import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { HealthService } from "./health.service.js";
import { send } from "../../common/http/http.js";
@Controller("health")
export class HealthController {
  constructor(private readonly service: HealthService) {}
  @Get()
  status(@Res() res: Response) {
    return send(res, this.service.get());
  }
}
