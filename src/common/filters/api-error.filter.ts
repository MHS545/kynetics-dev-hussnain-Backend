import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : (error as { status?: number })?.status;
    const safeStatus = status && status >= 400 && status < 600 ? status : 500;
    response.status(safeStatus).json({
      error:
        safeStatus === 413
          ? "Request too large."
          : safeStatus === 400
            ? "Invalid request."
            : safeStatus === 401
              ? "Sign in to open this workspace."
              : safeStatus === 404
                ? "Endpoint not found."
                : "Request failed. Please retry.",
    });
  }
}
