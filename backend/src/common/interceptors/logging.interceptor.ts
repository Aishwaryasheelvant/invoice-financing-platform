import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Logs method/path/status/duration for every request. Deliberately never
 * logs request or response bodies: /auth/login and /auth/register carry
 * plaintext passwords, and refresh tokens flow through /auth/refresh and
 * /auth/logout — none of that belongs in application logs.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, originalUrl } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          this.logger.log(`${method} ${originalUrl} ${response.statusCode} ${Date.now() - start}ms`);
        },
        error: (err: { status?: number }) => {
          const statusCode = err.status ?? 500;
          this.logger.warn(`${method} ${originalUrl} ${statusCode} ${Date.now() - start}ms`);
        },
      }),
    );
  }
}
