/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@shopsphere/config/tailwind')],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    // PRD §4 breakpoints: 360 / 768 / 1024 / 1440.
    screens: { xs: '360px', sm: '640px', md: '768px', lg: '1024px', xl: '1440px' },
    extend: {
      maxWidth: { page: '1500px' },
      keyframes: {
        'cart-pop': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.6)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: { 'cart-pop': 'cart-pop 400ms ease-out' },
      colors: {
        brand: { DEFAULT: '#2266dd', dark: '#1a5bd0', darker: '#0f3f99', navy: '#172337' },
        accent: { DEFAULT: '#fb641b', dark: '#c2410c', darker: '#9a3412' },
        cta: { DEFAULT: '#ffd814', dark: '#f7ca00' },
        deal: { DEFAULT: '#b91c1c' },
        plus: { DEFAULT: '#1a5bd0' },
      },
    },
  },
};
