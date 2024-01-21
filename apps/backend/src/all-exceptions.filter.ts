import { Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : 500;

    const message = (exception as any)?.message;
    const stack = (exception as any)?.stack;

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      // Include the stack trace if it exists
      // TODO: Disable or filter out these stack traces in a production environment, as they may contain sensitive information.
      stack
    };

    if (status === 500) {
      Logger.error('** Internal Server Error **', { path: request.url, message });
    }

    response.status(status).json(errorResponse);
  }
}
