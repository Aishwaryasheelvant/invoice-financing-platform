import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Single place all thrown errors funnel through, so every error response
 * has the same shape regardless of which controller/service threw it.
 * Unexpected (non-HttpException) errors are logged with a full stack
 * trace server-side but never leak their details to the client — only a
 * generic 500 message goes out.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const { error, message } = this.resolveErrorAndMessage(exception, status);

    const body: ErrorResponseBody = {
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${JSON.stringify(message)}`);
    }

    response.status(status).json(body);
  }

  private resolveErrorAndMessage(exception: unknown, status: number): { error: string; message: string | string[] } {
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Never leak internals (stack traces, DB error text, etc.) to the client.
      return { error: 'Internal Server Error', message: 'Internal server error' };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { error: exception.name, message: payload };
      }
      const { message, error } = payload as { message?: string | string[]; error?: string };
      return {
        error: error ?? exception.name,
        message: message ?? exception.message,
      };
    }

    return { error: 'Error', message: 'Unexpected error' };
  }
}
