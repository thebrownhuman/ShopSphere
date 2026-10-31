import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@shopsphere/types';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './app-error';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
};

export function toApiError(exception: unknown): { status: number; body: ApiError } {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: { code: exception.code, message: exception.message, details: exception.details },
    };
  }
  if (exception instanceof ZodError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: exception.issues },
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    const message =
      typeof res === 'string' ? res : ((res as { message?: unknown }).message ?? exception.message);
    return {
      status,
      body: {
        code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR'),
        message: Array.isArray(message) ? 'Validation failed' : String(message),
        details: Array.isArray(message) ? message : undefined,
      },
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const { status, body } = toApiError(exception);
    if (status >= 500) {
      this.logger.error({ requestId: req.requestId, err: exception }, 'unhandled error');
    }
    res.status(status).json(body);
  }
}
