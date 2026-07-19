import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/**
 * Attach `Cache-Control: no-store` to EVERY error response, then let
 * Nest's built-in error rendering run.
 *
 * Why: the backend HARD RULE says every route controls its own
 * caching, and errors (400/404/429/500) MUST be `no-store` to prevent
 * cache poisoning at the Cloudflare edge (a 404 briefly cached during
 * a sync gap keeps returning long after the data lands; a 429 from a
 * momentary throttler hit keeps blocking a legitimate client from the
 * edge).
 *
 * Controllers that reach their happy-path body can (and do) set
 * `Cache-Control` themselves via `reply.header(...)`. But guards
 * (ThrottlerGuard), pipes (ValidationPipe), and interceptors throw
 * BEFORE the controller method runs, so those response headers never
 * get set by the manual pattern. This filter is the single place
 * where every error path picks up `no-store` regardless of who threw.
 *
 * The filter delegates the actual error body/status to Nest's default
 * handler via `httpAdapter.reply` — we ONLY add the header.
 */
@Catch()
export class NoStoreOnErrorFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    // Nest's HttpException carries a status + body; everything else is
    // an unexpected 500. Match the built-in filter's behaviour so we
    // don't regress standard error shapes.
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: 500, message: 'Internal server error' };

    httpAdapter.setHeader(response, 'Cache-Control', 'no-store');
    httpAdapter.reply(response, body, status);
  }
}
