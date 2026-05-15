<script setup lang="ts">
useHead({ title: 'Ownership Transfer - SWS Admin' })

interface Project {
  Project_ID: string
  Customer_Address: string
  Project_Folder: string
  isTransfered: boolean | null
}

const projects = ref<Project[]>([])
const loading = ref(true)
const running = ref(false)
const stopped = ref(false)
const currentIdx = ref(-1)
const currentProject = ref<Project | null>(null)
const currentStatus = ref('')
const results = ref<{ id: string; address: string; status: string; copied: number; skipped: number; failed: number }[]>([])
const error = ref('')

// Stats
const totalProjects = computed(() => projects.value.length)
const pendingProjects = computed(() => projects.value.filter(p => !p.isTransfered).length)
const doneProjects = computed(() => projects.value.filter(p => p.isTransfered).length)
const progressPct = computed(() => {
  if (!totalProjects.value) return 0
  return Math.round(((doneProjects.value + results.value.length) / totalProjects.value) * 100)
})

// Extract folder ID from URL
function extractFolderId(url: string): string | null {
  if (!url) return null
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// Load projects from BigQuery
async function loadProjects() {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<{ projects: any[] }>('/api/transfer/projects')
    projects.value = (data.projects || []).map((p: any) => ({
      Project_ID: p.Project_ID || p['Project ID'] || '',
      Customer_Address: p.Customer_Address || p['Customer Address'] || '',
      Project_Folder: p.Project_Folder || p['Project Folder'] || '',
      isTransfered: p.isTransfered === true || p.isTransfered === 'true',
    }))
  } catch (err: any) {
    error.value = err.message || 'Failed to load projects'
  }
  loading.value = false
}

// Process all pending projects
async function startTransfer() {
  running.value = true
  stopped.value = false
  results.value = []
  error.value = ''

  const pending = projects.value.filter(p => !p.isTransfered)

  for (let i = 0; i < pending.length; i++) {
    if (stopped.value) break

    const project = pending[i]
    currentIdx.value = i
    currentProject.value = project
    currentStatus.value = 'Processing...'

    const folderId = extractFolderId(project.Project_Folder)
    if (!folderId) {
      results.value.push({
        id: project.Project_ID,
        address: project.Customer_Address,
        status: 'skipped',
        copied: 0, skipped: 0, failed: 0,
      })
      currentStatus.value = 'No valid folder URL'
      continue
    }

    try {
      const res = await $fetch<{ success: boolean; copied: number; skipped: number; failed: number }>(
        '/api/transfer/process',
        {
          method: 'POST',
          body: { folderId, projectId: project.Project_ID },
          timeout: 300000, // 5 min timeout per project
        },
      )
      project.isTransfered = true
      results.value.push({
        id: project.Project_ID,
        address: project.Customer_Address,
        status: 'done',
        copied: res.copied,
        skipped: res.skipped,
        failed: res.failed,
      })
      currentStatus.value = `✅ Done — ${res.copied} copied, ${res.skipped} skipped`
    } catch (err: any) {
      results.value.push({
        id: project.Project_ID,
        address: project.Customer_Address,
        status: 'error',
        copied: 0, skipped: 0, failed: 1,
      })
      currentStatus.value = `❌ Error: ${err.message || 'Unknown'}`
    }

    // Small delay between projects
    await new Promise(r => setTimeout(r, 500))
  }

  currentProject.value = null
  currentIdx.value = -1
  running.value = false
  currentStatus.value = stopped.value ? 'Stopped by user' : 'All done!'
}

function stopTransfer() {
  stopped.value = true
  currentStatus.value = 'Stopping after current project...'
}

onMounted(loadProjects)
</script>

<template>
  <div class="transfer-page">
    <!-- Header -->
    <header class="transfer-header">
      <div class="header-content">
        <div class="header-left">
          <div class="header-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 3h5v5"/>
              <path d="M8 3H3v5"/>
              <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/>
              <path d="m15 9 6-6"/>
            </svg>
          </div>
          <div>
            <h1>Ownership Transfer</h1>
            <p class="subtitle">Bulk transfer Drive file ownership</p>
          </div>
        </div>
        <div class="header-actions">
          <button v-if="!running" class="btn btn-primary" :disabled="loading || pendingProjects === 0" @click="startTransfer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
            Start Transfer
          </button>
          <button v-else class="btn btn-danger" @click="stopTransfer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            Stop
          </button>
          <button class="btn btn-secondary" :disabled="running" @click="loadProjects">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Refresh
          </button>
        </div>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{{ totalProjects }}</div>
        <div class="stat-label">Total Projects</div>
      </div>
      <div class="stat-card stat-pending">
        <div class="stat-value">{{ pendingProjects }}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card stat-done">
        <div class="stat-value">{{ doneProjects }}</div>
        <div class="stat-label">Already Done</div>
      </div>
      <div class="stat-card stat-session">
        <div class="stat-value">{{ results.length }}</div>
        <div class="stat-label">This Session</div>
      </div>
    </div>

    <!-- Progress Bar -->
    <div v-if="running || results.length > 0" class="progress-section">
      <div class="progress-header">
        <span class="progress-text">
          <template v-if="running && currentProject">
            Processing: <strong>{{ currentProject.Customer_Address || currentProject.Project_ID }}</strong>
          </template>
          <template v-else-if="!running && results.length">
            {{ currentStatus }}
          </template>
        </span>
        <span class="progress-pct">{{ progressPct }}%</span>
      </div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" :style="{ width: progressPct + '%' }" :class="{ pulsing: running }"/>
      </div>
      <div class="progress-sub">
        {{ doneProjects + results.length }} / {{ totalProjects }} projects processed
      </div>
    </div>

    <!-- Current Status -->
    <div v-if="running && currentStatus" class="current-status">
      <div class="status-dot" :class="{ active: running }"/>
      {{ currentStatus }}
    </div>

    <!-- Error -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"/>
      <span>Loading projects from BigQuery...</span>
    </div>

    <!-- Results Log -->
    <div v-if="results.length > 0" class="results-section">
      <h2>Session Log</h2>
      <div class="results-table">
        <div class="results-header">
          <span class="col-status">Status</span>
          <span class="col-id">Project ID</span>
          <span class="col-address">Address</span>
          <span class="col-stats">Copied</span>
          <span class="col-stats">Skipped</span>
          <span class="col-stats">Failed</span>
        </div>
        <div v-for="r in [...results].reverse()" :key="r.id" class="results-row" :class="'row-' + r.status">
          <span class="col-status">
            <span v-if="r.status === 'done'" class="badge badge-done">✅</span>
            <span v-else-if="r.status === 'error'" class="badge badge-error">❌</span>
            <span v-else class="badge badge-skip">⏭️</span>
          </span>
          <span class="col-id">{{ r.id }}</span>
          <span class="col-address">{{ r.address }}</span>
          <span class="col-stats">{{ r.copied }}</span>
          <span class="col-stats">{{ r.skipped }}</span>
          <span class="col-stats">{{ r.failed }}</span>
        </div>
      </div>
    </div>

    <!-- Projects Preview (when not running) -->
    <div v-if="!loading && !running && projects.length > 0" class="projects-preview">
      <h2>Projects ({{ pendingProjects }} pending)</h2>
      <div class="preview-list">
        <div v-for="p in projects.slice(0, 100)" :key="p.Project_ID" class="preview-item" :class="{ 'is-done': p.isTransfered }">
          <span class="preview-status">
            <span v-if="p.isTransfered" class="dot dot-done"/>
            <span v-else class="dot dot-pending"/>
          </span>
          <span class="preview-id">{{ p.Project_ID }}</span>
          <span class="preview-address">{{ p.Customer_Address }}</span>
          <span class="preview-transferred" v-if="p.isTransfered">transferred</span>
        </div>
        <div v-if="projects.length > 100" class="preview-more">
          ... and {{ projects.length - 100 }} more
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transfer-page {
  min-height: 100vh;
  background: #0a0a0f;
  color: #e4e4e7;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  padding-bottom: 4rem;
}

/* Header */
.transfer-header {
  background: linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08));
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 1.25rem 2rem;
}
.header-content {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.header-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}
h1 { font-size: 1.25rem; font-weight: 700; margin: 0; color: #f4f4f5; }
.subtitle { font-size: 0.8rem; color: #71717a; margin: 0; }
.header-actions { display: flex; gap: 0.5rem; }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  border: none;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  box-shadow: 0 0 20px rgba(59,130,246,0.25);
}
.btn-primary:hover:not(:disabled) { box-shadow: 0 0 30px rgba(59,130,246,0.4); transform: translateY(-1px); }
.btn-danger {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  box-shadow: 0 0 20px rgba(239,68,68,0.25);
}
.btn-danger:hover { box-shadow: 0 0 30px rgba(239,68,68,0.4); }
.btn-secondary {
  background: rgba(255,255,255,0.06);
  color: #a1a1aa;
  border: 1px solid rgba(255,255,255,0.08);
}
.btn-secondary:hover:not(:disabled) { background: rgba(255,255,255,0.1); color: white; }

/* Stats */
.stats-grid {
  max-width: 1200px;
  margin: 1.5rem auto;
  padding: 0 2rem;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}
.stat-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 14px;
  padding: 1.25rem;
  text-align: center;
}
.stat-value { font-size: 2rem; font-weight: 800; color: #f4f4f5; font-variant-numeric: tabular-nums; }
.stat-label { font-size: 0.75rem; color: #71717a; margin-top: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }
.stat-pending .stat-value { color: #f59e0b; }
.stat-done .stat-value { color: #22c55e; }
.stat-session .stat-value { color: #3b82f6; }

/* Progress */
.progress-section {
  max-width: 1200px;
  margin: 1.5rem auto;
  padding: 0 2rem;
}
.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.progress-text { font-size: 0.85rem; color: #a1a1aa; }
.progress-text strong { color: #f4f4f5; }
.progress-pct { font-size: 1.5rem; font-weight: 800; color: #3b82f6; }
.progress-bar-track {
  height: 8px;
  background: rgba(255,255,255,0.06);
  border-radius: 8px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  border-radius: 8px;
  transition: width 0.5s ease;
}
.progress-bar-fill.pulsing {
  animation: pulse-bar 1.5s ease-in-out infinite;
}
@keyframes pulse-bar {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
.progress-sub { font-size: 0.75rem; color: #52525b; margin-top: 0.5rem; text-align: right; }

/* Current Status */
.current-status {
  max-width: 1200px;
  margin: 1rem auto;
  padding: 0.75rem 2rem;
  font-size: 0.85rem;
  color: #a1a1aa;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #52525b;
}
.status-dot.active {
  background: #22c55e;
  animation: blink 1s infinite;
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* Error */
.error-banner {
  max-width: 1200px;
  margin: 1rem auto;
  padding: 0.75rem 1.25rem;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.2);
  border-radius: 10px;
  color: #fca5a5;
  font-size: 0.85rem;
  margin-left: 2rem;
  margin-right: 2rem;
}

/* Loading */
.loading-state {
  max-width: 1200px;
  margin: 3rem auto;
  text-align: center;
  color: #71717a;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}
.spinner {
  width: 20px; height: 20px;
  border: 2px solid rgba(255,255,255,0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Results */
.results-section {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 2rem;
}
.results-section h2 {
  font-size: 1rem;
  font-weight: 600;
  color: #a1a1aa;
  margin-bottom: 0.75rem;
}
.results-table {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  overflow: hidden;
  max-height: 400px;
  overflow-y: auto;
}
.results-header, .results-row {
  display: grid;
  grid-template-columns: 60px 120px 1fr 80px 80px 80px;
  padding: 0.6rem 1rem;
  align-items: center;
  font-size: 0.8rem;
}
.results-header {
  background: rgba(255,255,255,0.04);
  color: #71717a;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  position: sticky;
  top: 0;
}
.results-row {
  border-top: 1px solid rgba(255,255,255,0.04);
}
.results-row:hover { background: rgba(255,255,255,0.03); }
.row-done { color: #d4d4d8; }
.row-error { color: #fca5a5; }
.row-skipped { color: #a1a1aa; }
.col-stats { text-align: center; font-variant-numeric: tabular-nums; }
.col-address { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: 1rem; }

/* Projects Preview */
.projects-preview {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 2rem;
}
.projects-preview h2 {
  font-size: 1rem;
  font-weight: 600;
  color: #a1a1aa;
  margin-bottom: 0.75rem;
}
.preview-list {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  overflow: hidden;
  max-height: 500px;
  overflow-y: auto;
}
.preview-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid rgba(255,255,255,0.03);
  font-size: 0.8rem;
}
.preview-item:first-child { border-top: none; }
.preview-item.is-done { opacity: 0.4; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot-done { background: #22c55e; }
.dot-pending { background: #f59e0b; }
.preview-id { width: 120px; color: #71717a; font-variant-numeric: tabular-nums; }
.preview-address { flex: 1; color: #d4d4d8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-transferred {
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  border-radius: 6px;
  background: rgba(34,197,94,0.1);
  color: #4ade80;
}
.preview-more {
  text-align: center;
  padding: 0.75rem;
  color: #52525b;
  font-size: 0.8rem;
}
</style>
