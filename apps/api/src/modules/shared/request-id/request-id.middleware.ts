import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_ID = /^[A-Za-z0-9._-]{1,128}$/;

declare module 'express' {
  interface Request {
    requestId: string;
  }
}

/** Reuse a sane inbound X-Request-Id (from the edge/LB) or mint one; echo it on the response. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header(REQUEST_ID_HEADER);
    req.requestId = inbound && VALID_ID.test(inbound) ? inbound : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, req.requestId);
    next();
  }
}
