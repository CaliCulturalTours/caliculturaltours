// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://www.caliculturaltours.com',
  output: 'server',
  adapter: vercel(),
});
