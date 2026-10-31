import { HttpStatus } from '@nestjs/common';

/** Domain error: thrown by modules, rendered by GlobalExceptionFilter as {code, message, details}. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
