import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tile } from '@/test/fixtures';
import { ProductTile } from './product-tile';

describe('ProductTile', () => {
  it('shows image, title link, rating, price, MRP, discount, Plus and delivery', () => {
    render(<ProductTile product={tile} />);
    expect(screen.getByRole('img', { name: 'Sony WH-1000XM5, front view' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tile.title })).toHaveAttribute(
      'href',
      '/p/sony-wh-1000xm5',
    );
    expect(screen.getByText('4.4 out of 5 stars, 18432 ratings')).toBeInTheDocument();
    expect(screen.getByTestId('price')).toHaveTextContent('₹26,990');
    expect(screen.getByText('₹34,990').tagName).toBe('S');
    expect(screen.getByText('-22%')).toBeInTheDocument();
    expect(screen.getByLabelText('ShopSphere Plus: fulfilled by ShopSphere')).toBeInTheDocument();
    expect(screen.getByText(/FREE delivery/)).toHaveTextContent('FREE delivery Tomorrow');
  });

  it('marks out-of-stock and sponsored tiles, hides % off without a discount', () => {
    render(
      <ProductTile
        product={{ ...tile, inStock: false, sponsored: true, mrp: tile.price, plus: false }}
      />,
    );
    expect(screen.getByText('Currently unavailable')).toBeInTheDocument();
    expect(screen.getByText('Sponsored')).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/FREE delivery/)).not.toBeInTheDocument();
  });

  it('compact variant drops the delivery line', () => {
    render(<ProductTile product={tile} compact />);
    expect(screen.queryByText(/FREE delivery/)).not.toBeInTheDocument();
  });
});
