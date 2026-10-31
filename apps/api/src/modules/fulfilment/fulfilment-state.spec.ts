import { orderPath, orderTargetFor, trackingApplies } from './fulfilment-state';

describe('tracking rules', () => {
  it('applies forward moves only, after a label exists', () => {
    expect(trackingApplies('LABEL_CREATED', 'SHIPPED')).toBe(true);
    expect(trackingApplies('SHIPPED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(trackingApplies('SHIPPED', 'DELIVERED')).toBe(true); // skipped OFD
    expect(trackingApplies('DELIVERED', 'OUT_FOR_DELIVERY')).toBe(false); // out of order
    expect(trackingApplies('SHIPPED', 'SHIPPED')).toBe(false); // duplicate status
    expect(trackingApplies('PACKED', 'SHIPPED')).toBe(false); // no label yet
    expect(trackingApplies('CANCELLED', 'DELIVERED')).toBe(false);
  });

  it('order follows the slowest live shipment', () => {
    expect(orderTargetFor(['PENDING'])).toBeNull();
    expect(orderTargetFor(['CONFIRMED'])).toBeNull();
    expect(orderTargetFor(['ACCEPTED', 'PACKED'])).toBeNull();
    expect(orderTargetFor(['PACKED', 'LABEL_CREATED'])).toBe('PACKED');
    expect(orderTargetFor(['DELIVERED', 'SHIPPED'])).toBe('SHIPPED');
    expect(orderTargetFor(['DELIVERED', 'OUT_FOR_DELIVERY'])).toBe('OUT_FOR_DELIVERY');
    expect(orderTargetFor(['DELIVERED', 'CANCELLED'])).toBe('DELIVERED');
    expect(orderTargetFor(['CANCELLED'])).toBeNull();
  });

  it('walks the M4 state machine without inventing skipped steps', () => {
    expect(orderPath('CONFIRMED', 'PACKED')).toEqual(['PACKED']);
    expect(orderPath('CONFIRMED', 'DELIVERED')).toEqual(['PACKED', 'SHIPPED', 'DELIVERED']);
    expect(orderPath('PACKED', 'OUT_FOR_DELIVERY')).toEqual(['SHIPPED', 'OUT_FOR_DELIVERY']);
    expect(orderPath('SHIPPED', 'DELIVERED')).toEqual(['DELIVERED']);
    expect(orderPath('OUT_FOR_DELIVERY', 'DELIVERED')).toEqual(['DELIVERED']);
    expect(orderPath('DELIVERED', 'SHIPPED')).toEqual([]); // never regress
    expect(orderPath('DELIVERED', 'DELIVERED')).toEqual([]);
    expect(orderPath('CANCELLED', 'DELIVERED')).toEqual([]);
  });
});
