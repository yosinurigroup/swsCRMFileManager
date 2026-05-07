<script setup lang="ts">
useHead({
  title: 'SWS Drive File Manager',
  meta: [
    { name: 'description', content: 'Secure Google Drive File Manager — browse, upload, move, rename, and download files' },
  ],
})

// Check if user has an active session — redirect to their folder
const { data: session } = await useFetch('/api/auth/session')

onMounted(() => {
  if (session.value?.authenticated && session.value?.folderId) {
    navigateTo(`/files/${session.value.folderId}`)
  }
})
</script>

<template>
  <div class="hero-gradient min-h-screen flex flex-col">
    <!-- Header -->
    <header class="flex items-center justify-between px-8 py-5">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background: linear-gradient(135deg, #1da462, #0f7b3f); box-shadow: 0 4px 20px rgba(29, 164, 98, 0.3);">
          <svg class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.5 19.5l3-5.25H21l-3 5.25H4.5z" opacity=".7" />
            <path d="M12 4.5L4.5 17.25l3 2.25L15 7.5 12 4.5z" opacity=".85" />
            <path d="M21 15l-4.5-7.5L13.5 9l4.5 7.5L21 15z" />
          </svg>
        </div>
        <div>
          <h1 class="text-base font-bold tracking-tight" style="color: var(--text-primary)">SWS Drive Manager</h1>
          <p class="text-xs" style="color: var(--text-tertiary)">Secure File Management System</p>
        </div>
      </div>
    </header>

    <!-- Hero section -->
    <main class="flex-1 flex flex-col items-center justify-center px-6 -mt-16">
      <div class="animate-fade-in text-center max-w-2xl w-full">
        <!-- Icon cluster -->
        <div class="flex items-center justify-center gap-4 mb-8">
          <div class="w-14 h-14 rounded-2xl flex items-center justify-center animate-bounce-in" style="background: rgba(29, 164, 98, 0.1); animation-delay: 0s;">
            <Icon name="i-lucide-shield-check" class="w-7 h-7" style="color: var(--drive-green)" />
          </div>
          <div class="w-20 h-20 rounded-3xl flex items-center justify-center animate-bounce-in" style="background: linear-gradient(135deg, rgba(29,164,98,0.15), rgba(52,168,83,0.1)); box-shadow: var(--shadow-glow); animation-delay: 0.1s;">
            <svg class="w-10 h-10" viewBox="0 0 24 24" fill="#1da462">
              <path d="M4.5 19.5l3-5.25H21l-3 5.25H4.5z" opacity=".7" />
              <path d="M12 4.5L4.5 17.25l3 2.25L15 7.5 12 4.5z" opacity=".85" />
              <path d="M21 15l-4.5-7.5L13.5 9l4.5 7.5L21 15z" />
            </svg>
          </div>
          <div class="w-14 h-14 rounded-2xl flex items-center justify-center animate-bounce-in" style="background: rgba(139, 92, 246, 0.1); animation-delay: 0.2s;">
            <Icon name="i-lucide-lock" class="w-7 h-7" style="color: var(--accent-violet)" />
          </div>
        </div>

        <h2 class="text-4xl font-extrabold tracking-tight mb-3" style="background: linear-gradient(135deg, #f0f0f5, #8b8b9e); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
          Secure File Manager
        </h2>
        <p class="text-base mb-10" style="color: var(--text-secondary); max-width: 480px; margin-left: auto; margin-right: auto;">
          Access is restricted to authorized users only. Please use the link provided in your application to open the file manager.
        </p>

        <!-- Access info card -->
        <div class="glass rounded-2xl p-6 max-w-md mx-auto text-left">
          <div class="flex items-start gap-3 mb-4">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background:rgba(59,130,246,0.1)">
              <Icon name="i-lucide-info" class="w-5 h-5" style="color:#3b82f6"/>
            </div>
            <div>
              <p class="text-sm font-semibold" style="color:var(--text-primary)">How to access files</p>
              <p class="text-xs mt-1" style="color:var(--text-tertiary)">Click the file manager button from your CRM application. A secure, single-session link will be generated for you.</p>
            </div>
          </div>
          <div class="space-y-2.5">
            <div class="flex items-center gap-3">
              <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style="background:#1da462">1</div>
              <p class="text-xs" style="color:var(--text-secondary)">Open your CRM application</p>
            </div>
            <div class="flex items-center gap-3">
              <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style="background:#1da462">2</div>
              <p class="text-xs" style="color:var(--text-secondary)">Click the "Open Files" action button</p>
            </div>
            <div class="flex items-center gap-3">
              <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style="background:#1da462">3</div>
              <p class="text-xs" style="color:var(--text-secondary)">You'll be securely authenticated and redirected</p>
            </div>
          </div>
        </div>

        <!-- Features grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-14 max-w-xl mx-auto">
          <div v-for="(feat, i) in [
            { icon: 'i-lucide-upload', label: 'Upload', color: '#1da462' },
            { icon: 'i-lucide-download', label: 'Download', color: '#3b82f6' },
            { icon: 'i-lucide-folder-symlink', label: 'Move', color: '#8b5cf6' },
            { icon: 'i-lucide-shield-check', label: 'Secure', color: '#f59e0b' },
          ]" :key="feat.label"
            class="glass rounded-xl p-4 text-center animate-slide-up"
            :style="{ animationDelay: `${i * 0.08}s` }"
          >
            <div class="w-9 h-9 rounded-lg mx-auto mb-2 flex items-center justify-center" :style="{ background: `${feat.color}15` }">
              <Icon :name="feat.icon" class="w-4.5 h-4.5" :style="{ color: feat.color }" />
            </div>
            <p class="text-xs font-semibold" style="color: var(--text-secondary)">{{ feat.label }}</p>
          </div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="px-8 py-4 flex items-center justify-between">
      <p class="text-xs" style="color: var(--text-tertiary)">SWS CRM File Manager</p>
      <div class="flex items-center gap-1.5">
        <div class="w-1.5 h-1.5 rounded-full" style="background: var(--drive-green); box-shadow: 0 0 6px rgba(29,164,98,0.5);"></div>
        <span class="text-xs" style="color: var(--text-tertiary)">Protected Access</span>
      </div>
    </footer>
  </div>
</template>
