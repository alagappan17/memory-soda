// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

/**
 * The sidebar is generated from nav.json rather than the filesystem: order is
 * meaningful (installation before quickstart) and alphabetical would be wrong.
 * One source of truth — adding a page means editing nav.json, not two places.
 *
 * @typedef {{ title: string, path: string, slug: string }} NavPage
 * @typedef {{ title: string, slug: string, pages: NavPage[] }} NavSection
 */
const nav = /** @type {{ sections: NavSection[] }} */ (
  JSON.parse(readFileSync(fileURLToPath(new URL('./nav.json', import.meta.url)), 'utf8'))
);

/** `introduction/overview.md` → `introduction/overview`, `sdk/index.md` → `sdk`. */
const toSlug = (path) => path.replace(/\.md$/, '').replace(/(^|\/)index$/, '');

export default defineConfig({
  site: 'https://memory-soda.dev',
  integrations: [
    starlight({
      title: 'memory-soda',
      description: 'A self-hostable memory layer for AI agents.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/alagappan17/memory-soda',
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/alagappan17/memory-soda/edit/main/apps/docs/',
      },
      lastUpdated: true,
      customCss: ['./src/styles/custom.css'],
      // Pinned rather than left to the default so the greyscale filter in
      // custom.css has a predictable lightness distribution to work from.
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        styleOverrides: {
          borderRadius: '0.45rem',
          borderColor: 'var(--sl-color-hairline)',
          codeBackground: 'var(--sl-color-bg-inline-code)',
          frames: { shadowColor: 'transparent' },
        },
      },
      sidebar: nav.sections.map((section) => ({
        label: section.title,
        items: section.pages.map((page) => ({
          label: page.title,
          slug: toSlug(page.path),
        })),
      })),
    }),
  ],
});
