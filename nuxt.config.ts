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
    auth: {
      secret: '', // NUXT_AUTH_SECRET
      apiKey: '', // NUXT_AUTH_API_KEY
    },
    drive: {
      email: '',
      clientId: '',
      clientSecret: '',
      refreshToken: '',
    },
    bigquery: {
      projectId: '',    // NUXT_BIGQUERY_PROJECT_ID
      dataset: '',      // NUXT_BIGQUERY_DATASET
      clientEmail: '',  // NUXT_BIGQUERY_CLIENT_EMAIL
      privateKeyId: '', // NUXT_BIGQUERY_PRIVATE_KEY_ID
      privateKey: '',   // NUXT_BIGQUERY_PRIVATE_KEY
    },
    public: {
      driveEmail: '',
    },
  },

  compatibilityDate: '2024-12-14',
})
