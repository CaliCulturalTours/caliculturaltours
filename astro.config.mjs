import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://www.caliculturaltours.com',
  output: 'server',
  adapter: vercel(),
  redirects: {
    '/tours/waterfalls': '/tours/pance-waterfalls-tour',
    '/tours/salsa-tour': '/tours/cali-salsa-tour',
    '/tours/hummingbirds': '/tours/km18-cloud-forest-tour',
    '/tours/market-tour': '/tours/cali-market-fruit-tour',
    '/tours/coffee-tasting': '/tours/colombian-coffee-tasting-cali',
    '/tours/street-food': '/tours/cali-street-food-tour',
    '/tours/coffee-farm': '/tours/coffee-farm-day-trip',
    '/tours/chocotour': '/tours/chocolate-farm-tour',
    '/tours/cristo-rey': '/tours/cristo-rey-city-tour',
    '/tours/whale-watching': '/tours/pacific-whale-watching-tour',
  },
});
