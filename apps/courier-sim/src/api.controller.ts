import {
  ArgumentsHost,
  Body,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  Get,
  Header,
  HttpCode,
  HttpException,
  Injectable,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config';
import { CourierError, CourierService, type CourierShipment } from './courier.service';

/** API auth: `x-api-key` header, like Shiprocket/Delhivery tokens. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const given = Buffer.from(ctx.switchToHttp().getRequest<Request>().header('x-api-key') ?? '');
    const expected = Buffer.from(config.apiKey);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new CourierError(401, 'invalid api key');
    }
    return true;
  }
}

@Catch()
export class CourierErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      err instanceof CourierError
        ? err.status
        : err instanceof HttpException
          ? err.getStatus()
          : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'internal error' });
  }
}

const view = (s: CourierShipment) => ({
  awb: s.awb,
  reference: s.reference,
  status: s.status,
  zone: s.zone,
  slaDays: s.slaDays,
  ratePaise: s.ratePaise,
  weightGrams: s.weightGrams,
  labelUrl: `/v1/shipments/${s.awb}/label`,
  events: s.events,
  createdAt: s.createdAt,
});

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class CourierApiController {
  constructor(private readonly courier: CourierService) {}

  /** Full lane/SLA/rate matrix, pulled nightly by ShopSphere for delivery estimates. */
  @Get('serviceability/matrix')
  matrix() {
    return this.courier.matrix();
  }

  @Get('serviceability')
  serviceability(@Query('from') from: string, @Query('to') to: string) {
    return this.courier.quote({ fromPincode: from, toPincode: to });
  }

  @Post('rates')
  @HttpCode(200)
  rates(@Body() body: Record<string, unknown>) {
    return this.courier.quote(body ?? {});
  }

  @Post('shipments')
  @HttpCode(200)
  create(@Body() body: Record<string, unknown>) {
    return view(this.courier.create(body ?? {}));
  }

  @Get('shipments/:awb')
  track(@Param('awb') awb: string) {
    return view(this.courier.get(awb));
  }

  @Get('shipments/:awb/label')
  @Header('content-type', 'application/pdf')
  label(@Param('awb') awb: string, @Res() res: Response) {
    const pdf = this.courier.label(awb);
    res.setHeader('content-disposition', `inline; filename="${awb}.pdf"`);
    res.end(pdf);
  }

  /** Dev/test: move one tracking step now instead of waiting for the timer. */
  @Post('shipments/:awb/advance')
  @HttpCode(200)
  advance(@Param('awb') awb: string) {
    return view(this.courier.advance(awb));
  }

  /** Dev/test: re-send every webhook already emitted for this AWB. */
  @Post('shipments/:awb/replay')
  @HttpCode(200)
  replay(@Param('awb') awb: string) {
    return { replayed: this.courier.replay(awb) };
  }
}
