import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AddToCartResponse, CartResponse } from '@shopsphere/types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../shared/errors/app-error';
import { CartOwnerResolver, JsonWritesGuard } from './cart-owner';
import { CartService, type CartOwner } from './cart.service';

/** Same default the web uses before a shopper picks a pincode. */
export const DEFAULT_PINCODE = '560001';

const UUID = z.string().uuid();
const addSchema = z.object({
  sku: UUID,
  sellerId: UUID.optional(),
  qty: z.number().int().min(1).max(100),
  pincode: z.string().optional(),
});
const qtySchema = z.object({ qty: z.number().int().min(1).max(100) });

function lineId(id: string): string {
  if (!UUID.safeParse(id).success) {
    throw new AppError('LINE_NOT_FOUND', 'That item is no longer in your cart', 404);
  }
  return id;
}

/** M3.3 cart API. Prices never come from the client: responses carry server-computed totals. */
@Controller('cart')
@UseGuards(JsonWritesGuard)
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly owners: CartOwnerResolver,
  ) {}

  private pin(q?: string, body?: unknown): string {
    const b = (body as { pincode?: unknown } | undefined)?.pincode;
    return (q || (typeof b === 'string' ? b : '') || DEFAULT_PINCODE).trim();
  }

  /** Keeps a guest's cookie rolling (30 days from last write). */
  private touch(owner: CartOwner, res: Response, minted?: string) {
    const token = minted ?? ('guestToken' in owner ? owner.guestToken : null);
    if (token) this.owners.setGuest(res, token);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('pincode') pincode?: string,
  ): Promise<CartResponse> {
    const owner = await this.owners.resolve(req, res);
    return this.cart.view(await this.cart.findCartId(owner), this.pin(pincode));
  }

  @Post('items')
  @HttpCode(201)
  async add(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('pincode') pincode?: string,
  ): Promise<AddToCartResponse> {
    const input = addSchema.parse(body);
    const pin = this.pin(pincode, input);
    const owner = await this.owners.resolve(req, res);
    const r = await this.cart.addItem(owner, input, pin);
    this.touch(owner, res, r.guestToken);
    const [cart, addOns] = await Promise.all([
      this.cart.view(r.cartId, pin),
      this.cart.addOns(r.productId, r.cartId),
    ]);
    return { cart, lineId: r.lineId, addOns };
  }

  @Patch('items/:id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('pincode') pincode?: string,
  ): Promise<CartResponse> {
    const { qty } = qtySchema.parse(body);
    const owner = await this.owners.resolve(req, res);
    const cartId = await this.cart.updateItem(owner, lineId(id), qty);
    this.touch(owner, res);
    return this.cart.view(cartId, this.pin(pincode, body));
  }

  @Delete('items/:id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('pincode') pincode?: string,
  ): Promise<CartResponse> {
    const owner = await this.owners.resolve(req, res);
    const { cartId } = await this.cart.removeItem(owner, lineId(id));
    this.touch(owner, res);
    return this.cart.view(cartId, this.pin(pincode));
  }

  @Post('items/:id/save-for-later')
  @HttpCode(200)
  async saveForLater(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('pincode') pincode?: string,
  ): Promise<CartResponse> {
    const owner = await this.owners.resolve(req, res);
    const cartId = await this.cart.saveForLater(owner, lineId(id));
    this.touch(owner, res);
    return this.cart.view(cartId, this.pin(pincode));
  }

  @Post('saved/:id/move-to-cart')
  @HttpCode(200)
  async moveToCart(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('pincode') pincode?: string,
  ): Promise<CartResponse> {
    const owner = await this.owners.resolve(req, res);
    const pin = this.pin(pincode);
    const cartId = await this.cart.moveSavedToCart(owner, lineId(id), pin);
    this.touch(owner, res);
    return this.cart.view(cartId, pin);
  }

  @Delete('saved/:id')
  async removeSaved(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('pincode') pincode?: string,
  ): Promise<CartResponse> {
    const owner = await this.owners.resolve(req, res);
    const cartId = await this.cart.removeSaved(owner, lineId(id));
    this.touch(owner, res);
    return this.cart.view(cartId, this.pin(pincode));
  }
}
