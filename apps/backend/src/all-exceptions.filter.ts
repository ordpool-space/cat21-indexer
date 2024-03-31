import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';

import { toJson } from './to-json';


@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const exceptionStatus = exception instanceof HttpException ? exception.getStatus() : 500;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : {};

    let message = 'An unexpected error occurred.';
    const stack = (exception as Error)?.stack;

    if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {

       // Handle array of constraints for validation errors
      if (Array.isArray(exceptionResponse.message)) {
        message = exceptionResponse.message.map(msg => typeof msg === 'string' ? msg : JSON.stringify(msg)).join(' ');
      } else {
        message = (exceptionResponse.message).toString();
      }
    } else if ((exception as Error).message) {
      message = (exception as Error).message;
    }

    const errorResponse = {
      statusCode: exceptionStatus,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      stack: process.env.NODE_ENV !== 'production' ? stack : undefined
    };

    if (exceptionStatus === 500) {
      Logger.error(`** Internal Server Error ** ${ toJson({ path: request.url, exception }) }`, 'all_exceptions_filter');
    }

    response.status(exceptionStatus).json(errorResponse);
  }
}
