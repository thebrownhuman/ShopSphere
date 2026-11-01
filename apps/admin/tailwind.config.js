/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@shopsphere/config/tailwind')],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Same tokens as apps/web so packages/ui primitives render identically.
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
