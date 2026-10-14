// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// The site stays static. Pages that opt out with `export const prerender = false`
// (the private runway forecast and its API) run as Vercel functions.
export default defineConfig({
  site: 'https://stuffcammade.com',
  adapter: vercel(),
  // The home page is the projects list now; keep old links working.
  redirects: { '/projects': '/' },
});
