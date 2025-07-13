import starlight from '@astrojs/starlight';
// @ts-check
import { defineConfig } from 'astro/config';
import starlightNextjsTheme from 'starlight-nextjs-theme';

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'CadenceMQ',
      logo: {
        alt: 'CadenceMQ logo',
        light: './src/assets/logo-dark.svg',
        dark: './src/assets/logo-light.svg',
      },
      plugins: [starlightNextjsTheme()],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/papra-hq/cadence-mq' }],
      sidebar: [
        {
          label: 'Introduction',
          autogenerate: { directory: '01-introduction' },
        },
        {
          label: 'Drivers',
          autogenerate: { directory: '02-drivers' },
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/papra-hq/cadence-mq/edit/main/docs/',
      },
      lastUpdated: true,
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            href: '/favicon.ico',
            sizes: '48x48',
            type: 'image/x-icon',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            href: '/favicon-16x16.png',
            sizes: '16x16',
            type: 'image/png',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            href: '/favicon-32x32.png',
            sizes: '32x32',
            type: 'image/png',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'apple-touch-icon',
            href: '/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'manifest',
            href: '/site.webmanifest',
          },
        },
      ],
    }),
  ],
});
