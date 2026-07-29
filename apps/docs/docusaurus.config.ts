import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Compass',
  tagline: 'Self-hosted personal finance for the Indian context',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
    // v4:true implies future.v4.fasterByDefault, which would pull in the
    // @docusaurus/faster (swc/rspack) toolchain and its native binaries.
    // A docs site this small gains nothing from it, so opt out explicitly.
    faster: false,
  },

  // The docs are served by the app's own Caddy container (apps/web/Caddyfile)
  // under /docs/ on the same origin as the SPA. `url` only affects absolute
  // metadata (canonical, og:url); a self-hosted origin isn't known at build
  // time, so operators can set DOCS_URL to get correct canonical links.
  url: process.env.DOCS_URL ?? 'http://localhost',
  baseUrl: '/docs/',

  organizationName: 'udai-kiran',
  projectName: 'PennyPilot',

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          // baseUrl is already /docs/, so serve pages at its root (not /docs/docs/).
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/udai-kiran/PennyPilot/tree/main/apps/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Compass',
      items: [
        {
          // A raw-HTML item is emitted verbatim, with no baseUrl processing.
          // Both `href: '/'` and `href: 'pathname:///'` get rewritten to
          // '/docs/' here (baseUrl is '/docs/'), which loops back into the
          // docs instead of returning to the app.
          type: 'html',
          position: 'left',
          value:
            '<a class="navbar__item navbar__link" href="/" target="_self">← Back to app</a>',
        },
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/udai-kiran/PennyPilot',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Docs',
              to: '/',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/udai-kiran/PennyPilot',
            },
          ],
        },
      ],
      copyright: `Compass (PennyPilot) © ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
