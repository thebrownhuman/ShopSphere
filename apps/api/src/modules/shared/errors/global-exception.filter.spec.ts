import { BadRequestException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from './app-error';
import { toApiError } from './global-exception.filter';

describe('toApiError', () => {
  it('maps AppError', () => {
    const { status, body } = toApiError(
      new AppError('OUT_OF_STOCK', 'Gone', HttpStatus.CONFLICT, { sku: 'x' }),
    );
    expect(status).toBe(409);
    expect(body).toEqual({ code: 'OUT_OF_STOCK', message: 'Gone', details: { sku: 'x' } });
  });

  it('maps ZodError to VALIDATION_ERROR', () => {
    const err = z.object({ a: z.string() }).safeParse({}).error;
    expect(toApiError(err).body.code).toBe('VALIDATION_ERROR');
  });

  it('maps class-validator style message arrays into details', () => {
    const { body } = toApiError(new BadRequestException(['a is required']));
    expect(body).toEqual({
      code: 'BAD_REQUEST',
      message: 'Validation failed',
      details: ['a is required'],
    });
  });

  it('hides unknown errors', () => {
    expect(toApiError(new Error('secret'))).toEqual({
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
  });
});
