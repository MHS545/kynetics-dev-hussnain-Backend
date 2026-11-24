import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { raw } from "express";
import { AppModule } from "./app.module.js";
import { ApiErrorFilter } from "./common/filters/api-error.filter.js";
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.disable("x-powered-by");
  app.use(raw({ type: () => true, limit: "21mb" }));
  app.use(
    (
      _req: unknown,
      res: { setHeader: (key: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store, private");
      next();
    },
  );
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT || 4000),
    process.env.HOST || "127.0.0.1",
  );
}
bootstrap().catch(() => {
  console.error(
    "Backend could not start. Check configuration and port availability.",
  );
  process.exitCode = 1;
});
