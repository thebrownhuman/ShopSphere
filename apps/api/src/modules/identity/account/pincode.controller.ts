import { Controller, Get, Param } from '@nestjs/common';
import { AccountService } from './account.service';

/** Public: used by the address form (city/state autofill) before and after sign-in. */
@Controller('pincodes')
export class PincodeController {
  constructor(private readonly account: AccountService) {}

  @Get(':pincode')
  lookup(@Param('pincode') pincode: string) {
    return this.account.lookupPincode(pincode);
  }
}
