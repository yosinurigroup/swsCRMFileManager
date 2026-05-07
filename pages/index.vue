<script setup lang="ts">
const driveUrl = ref('')
const errorMsg = ref('')
const isLoading = ref(false)

function extractFolderId(url: string): string | null {
  // Match /folders/ID
  const m1 = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (m1) return m1[1] ?? null
  // Match ?id=ID
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1] ?? null
  // Match just a raw folder ID (no URL)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(url.trim())) return url.trim()
  return null
}

function openFileManager() {
  errorMsg.value = ''
  const folderId = extractFolderId(driveUrl.value)
  if (!folderId) {
    errorMsg.value = 'Invalid Google Drive folder URL. Please paste a valid link.'
    return
  }
  isLoading.value = true
  // Open in new tab
  const url = `/files/${folderId}`
  window.open(url, '_blank')
  setTimeout(() => { isLoading.value = false }, 800)
}

function handlePaste(e: ClipboardEvent) {
  setTimeout(() => {
    if (driveUrl.value && extractFolderId(driveUrl.value)) {
      openFileManager()
    }
  }, 100)
}

// Recent folders (stored in localStorage)
const recentFolders = ref<{ id: string, name: string, time: number }[]>([])

onMounted(() => {
  try {
    const saved = localStorage.getItem('driveManager_recent')
    if (saved) recentFolders.value = JSON.parse(saved)
  } catch {}
})

function openRecent(folder: { id: string }) {
  window.open(`/files/${folder.id}`, '_blank')
}

function clearRecents() {
  recentFolders.value = []
  localStorage.removeItem('driveManager_recent')
}

useHead({
  title: 'SWS Drive File Manager',
  meta: [
    { name: 'description', content: 'Standalone Google Drive File Manager — browse, upload, move, rename, copy, and download files' },
  ],
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
          <p class="text-xs" style="color: var(--text-tertiary)">File Management System</p>
        </div>
      </div>
    </header>

    <!-- Hero section -->
    <main class="flex-1 flex flex-col items-center justify-center px-6 -mt-16">
      <div class="animate-fade-in text-center max-w-2xl w-full">
        <!-- Icon cluster -->
        <div class="flex items-center justify-center gap-4 mb-8">
          <div class="w-14 h-14 rounded-2xl flex items-center justify-center animate-bounce-in" style="background: rgba(29, 164, 98, 0.1); animation-delay: 0s;">
            <Icon name="i-lucide-folder-open" class="w-7 h-7" style="color: var(--drive-green)" />
          </div>
          <div class="w-20 h-20 rounded-3xl flex items-center justify-center animate-bounce-in" style="background: linear-gradient(135deg, rgba(29,164,98,0.15), rgba(52,168,83,0.1)); box-shadow: var(--shadow-glow); animation-delay: 0.1s;">
            <svg class="w-10 h-10" viewBox="0 0 24 24" fill="#1da462">
              <path d="M4.5 19.5l3-5.25H21l-3 5.25H4.5z" opacity=".7" />
              <path d="M12 4.5L4.5 17.25l3 2.25L15 7.5 12 4.5z" opacity=".85" />
              <path d="M21 15l-4.5-7.5L13.5 9l4.5 7.5L21 15z" />
            </svg>
          </div>
          <div class="w-14 h-14 rounded-2xl flex items-center justify-center animate-bounce-in" style="background: rgba(139, 92, 246, 0.1); animation-delay: 0.2s;">
            <Icon name="i-lucide-hard-drive" class="w-7 h-7" style="color: var(--accent-violet)" />
          </div>
        </div>

        <h2 class="text-4xl font-extrabold tracking-tight mb-3" style="background: linear-gradient(135deg, #f0f0f5, #8b8b9e); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
          Google Drive File Manager
        </h2>
        <p class="text-base mb-10" style="color: var(--text-secondary); max-width: 480px; margin-left: auto; margin-right: auto;">
          Paste a Google Drive folder URL to browse, upload, rename, move, copy, and download files — all in one place.
        </p>

        <!-- Input -->
        <div class="relative w-full max-w-xl mx-auto">
          <div class="glass rounded-2xl p-1.5 transition-all duration-300 focus-within:border-[#1da462]/40" style="box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
            <div class="flex items-center gap-2">
              <div class="pl-4 flex items-center">
                <Icon name="i-lucide-link-2" class="w-5 h-5" style="color: var(--text-tertiary)" />
              </div>
              <input
                v-model="driveUrl"
                type="text"
                placeholder="Paste Google Drive folder URL…"
                class="flex-1 h-12 bg-transparent border-0 outline-none text-sm font-medium"
                style="color: var(--text-primary);"
                @paste="handlePaste"
                @keydown.enter="openFileManager"
              >
              <button
                class="btn-primary h-10 px-6 rounded-xl text-sm font-semibold shrink-0 mr-0.5"
                :disabled="isLoading || !driveUrl.trim()"
                @click="openFileManager"
              >
                <Icon v-if="isLoading" name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
                <Icon v-else name="i-lucide-arrow-right" class="w-4 h-4" />
                Open
              </button>
            </div>
          </div>

          <!-- Error -->
          <transition
            enter-active-class="transition-all duration-200"
            enter-from-class="opacity-0 -translate-y-1"
            enter-to-class="opacity-100 translate-y-0"
          >
            <p v-if="errorMsg" class="text-xs font-medium mt-3 text-center" style="color: var(--accent-red)">
              <Icon name="i-lucide-alert-circle" class="w-3.5 h-3.5 inline mr-1" />
              {{ errorMsg }}
            </p>
          </transition>
        </div>

        <!-- Features grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-14 max-w-xl mx-auto">
          <div v-for="(feat, i) in [
            { icon: 'i-lucide-upload', label: 'Upload', color: '#1da462' },
            { icon: 'i-lucide-download', label: 'Download', color: '#3b82f6' },
            { icon: 'i-lucide-folder-symlink', label: 'Move', color: '#8b5cf6' },
            { icon: 'i-lucide-pencil-line', label: 'Rename', color: '#f59e0b' },
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

        <!-- Recent folders -->
        <div v-if="recentFolders.length > 0" class="mt-12 max-w-xl mx-auto animate-fade-in">
          <div class="flex items-center justify-between mb-3">
            <p class="text-xs font-semibold uppercase tracking-wider" style="color: var(--text-tertiary)">Recent Folders</p>
            <button class="text-xs font-medium hover:underline" style="color: var(--text-tertiary)" @click="clearRecents">Clear</button>
          </div>
          <div class="space-y-1.5">
            <button
              v-for="folder in recentFolders.slice(0, 5)"
              :key="folder.id"
              class="glass glass-hover w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all"
              @click="openRecent(folder)"
            >
              <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: rgba(245, 158, 11, 0.1)">
                <Icon name="i-lucide-folder" class="w-4 h-4" style="color: var(--accent-amber)" />
              </div>
              <span class="text-sm font-medium flex-1 truncate" style="color: var(--text-primary)">{{ folder.name }}</span>
              <Icon name="i-lucide-arrow-up-right" class="w-3.5 h-3.5" style="color: var(--text-tertiary)" />
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="px-8 py-4 flex items-center justify-between">
      <p class="text-xs" style="color: var(--text-tertiary)">SWS CRM File Manager</p>
      <div class="flex items-center gap-1.5">
        <div class="w-1.5 h-1.5 rounded-full" style="background: var(--drive-green); box-shadow: 0 0 6px rgba(29,164,98,0.5);"></div>
        <span class="text-xs" style="color: var(--text-tertiary)">Connected to Google Drive</span>
      </div>
    </footer>
  </div>
</template>
