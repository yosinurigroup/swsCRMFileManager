import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  devtools: { enabled: false },

  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    },
  },

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  modules: [
    '@nuxt/icon',
    '@nuxtjs/color-mode',
  ],

  colorMode: {
    preference: 'dark',
    classSuffix: '',
  },

  runtimeConfig: {
    drive: {
      email: '',
      clientId: '',
      clientSecret: '',
      refreshToken: '',
    },
    public: {
      driveEmail: '',
    },
  },

  compatibilityDate: '2024-12-14',
})
