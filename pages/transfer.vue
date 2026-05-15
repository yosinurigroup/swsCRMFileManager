<script setup lang="ts">
useHead({ title: 'Ownership Transfer - SWS Admin' })

interface Project { Project_ID: string; Customer_Address: string; Project_Folder: string; isTransfered: boolean | null }
interface LogEntry { icon: string; text: string; time: string; depth: number }

const projects = ref<Project[]>([])
const loading = ref(true)
const running = ref(false)
const stopped = ref(false)
const currentIdx = ref(0)
const currentProject = ref<Project | null>(null)
const liveLog = ref<LogEntry[]>([])
const liveCopied = ref(0)
const liveSkipped = ref(0)
const liveFailed = ref(0)
const sessionProcessed = ref(0)
const error = ref('')
const logBox = ref<HTMLElement | null>(null)

const totalProjects = computed(() => projects.value.length)
const pendingProjects = computed(() => projects.value.filter(p => !p.isTransfered).length)
const doneProjects = computed(() => projects.value.filter(p => p.isTransfered).length)
const progressPct = computed(() => {
  const pending = projects.value.filter(p => !p.isTransfered)
  if (!pending.length) return 100
  return Math.round((sessionProcessed.value / pending.length) * 100)
})

function extractFolderId(url: string): string | null {
  const m = url?.match(/folders\/([a-zA-Z0-9_-]+)/)
  return m?.[1] ?? null
}

function now() { return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) }

async function loadProjects() {
  loading.value = true
  try {
    const d = await $fetch<{ projects: any[] }>('/api/transfer/projects')
    projects.value = (d.projects || []).map((p: any) => ({
      Project_ID: p.Project_ID || p['Project ID'] || '',
      Customer_Address: p.Customer_Address || p['Customer Address'] || '',
      Project_Folder: p.Project_Folder || p['Project Folder'] || '',
      isTransfered: p.isTansfered === true || p.isTansfered === 'true' || p.isTransfered === true || p.isTransfered === 'true',
    }))
  } catch (e: any) { error.value = e.message }
  loading.value = false
}

function addLog(icon: string, text: string, depth = 0) {
  liveLog.value.push({ icon, text, time: now(), depth })
  if (liveLog.value.length > 500) liveLog.value.shift()
  nextTick(() => { if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight })
}

async function processOneProject(project: Project): Promise<boolean> {
  const folderId = extractFolderId(project.Project_Folder)
  if (!folderId) { addLog('⏭️', `No folder URL — skipping`); return true }

  liveCopied.value = 0; liveSkipped.value = 0; liveFailed.value = 0

  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let gotComplete = false
    try {
      if (attempt > 1) addLog('🔁', `Retry ${attempt}/${MAX_RETRIES} — stream reconnecting...`)

      const res = await fetch('/api/transfer/process-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, projectId: project.Project_ID }),
      })

      if (!res.ok) {
        addLog('❌', `Server error ${res.status} — ${res.statusText}`)
        await new Promise(r => setTimeout(r, 3000))
        continue
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) { addLog('❌', 'No response stream'); continue }

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            const indent = '  '.repeat(ev.depth || 0)
            if (ev.copied !== undefined) { liveCopied.value = ev.copied; liveSkipped.value = ev.skipped; liveFailed.value = ev.failed }
            switch (ev.type) {
              case 'scan': addLog('📂', `${indent}Found ${ev.count} items`, ev.depth); break
              case 'file_start': addLog('🔄', `${indent}${ev.name} (${ev.owner})`, ev.depth); break
              case 'file_done': addLog('✅', `${indent}${ev.name} → copied`, ev.depth); break
              case 'file_error': addLog('❌', `${indent}${ev.name} — ${ev.error}`, ev.depth); break
              case 'folder_start': addLog('📁', `${indent}${ev.name} (${ev.owner})`, ev.depth); break
              case 'folder_done': addLog('✅', `${indent}${ev.name} → recreated`, ev.depth); break
              case 'folder_error': addLog('❌', `${indent}${ev.name} — ${ev.error}`, ev.depth); break
              case 'skip': break
              case 'complete': addLog('🎉', `Done! ${ev.copied} copied, ${ev.skipped} skipped, ${ev.failed} failed`); gotComplete = true; break
              case 'error': addLog('💥', `Error: ${ev.message}`); break
            }
          } catch {}
        }
      }

      if (gotComplete) {
        project.isTransfered = true
        return true
      }

      // Stream ended without 'complete' — likely Vercel timeout. Retry.
      addLog('⚠️', `Stream disconnected before completion (attempt ${attempt}/${MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, 2000))
    } catch (err: any) {
      addLog('💥', `Connection error: ${err.message || 'unknown'} (attempt ${attempt}/${MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // All retries exhausted — mark as done anyway (server-side already did partial work + BQ update)
  addLog('⚠️', `Max retries reached — moving to next project`)
  project.isTransfered = true
  return false
}

// ── Wake Lock — prevent browser/tab from sleeping ──
let wakeLock: any = null
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await (navigator as any).wakeLock.request('screen')
      addLog('🔒', 'Screen wake lock acquired — tab will stay active')
    }
  } catch {}
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null }
}

// ── Keepalive — ping every 20s to keep connection alive ──
let keepaliveTimer: any = null
function startKeepalive() {
  stopKeepalive()
  keepaliveTimer = setInterval(() => {
    // Simple self-ping to prevent idle timeout
    fetch('/api/auth/session').catch(() => {})
  }, 20000)
}
function stopKeepalive() {
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null }
}

async function startTransfer() {
  running.value = true; stopped.value = false; sessionProcessed.value = 0; liveLog.value = []; error.value = ''
  await requestWakeLock()
  startKeepalive()

  const pending = projects.value.filter(p => !p.isTransfered)
  addLog('🚀', `Starting transfer of ${pending.length} projects (auto-retry enabled)...`)

  for (let i = 0; i < pending.length; i++) {
    if (stopped.value) { addLog('🛑', 'Stopped by user'); break }
    currentIdx.value = i; currentProject.value = pending[i]!
    addLog('━', `━━━ [${i + 1}/${pending.length}] ${pending[i]!.Customer_Address || pending[i]!.Project_ID} ━━━`)
    try {
      await processOneProject(pending[i]!)
    } catch (err: any) {
      addLog('💥', `Unexpected error: ${err.message} — continuing to next project`)
    }
    sessionProcessed.value = i + 1
  }

  releaseWakeLock()
  stopKeepalive()
  currentProject.value = null; running.value = false
  if (!stopped.value) addLog('✨', `All done! ${sessionProcessed.value} projects processed.`)
}

function stopTransfer() { stopped.value = true; addLog('⏸️', 'Stopping after current project...') }

// ── Auto-start: check URL param ?auto=1 ──
onMounted(async () => {
  await loadProjects()
  const route = useRoute()
  if (route.query.auto === '1' && pendingProjects.value > 0) {
    addLog('🤖', 'Auto-start enabled — beginning transfer...')
    startTransfer()
  }
})
</script>

<template>
  <div class="tp">
    <header class="tp-hdr">
      <div class="tp-hdr-in">
        <div class="tp-hdr-left">
          <div class="tp-icon"><Icon name="lucide:repeat" size="22"/></div>
          <div><h1>Ownership Transfer</h1><p>Bulk copy &amp; archive from BigQuery Projects</p></div>
        </div>
        <div class="tp-hdr-acts">
          <button v-if="!running" class="btn bp" :disabled="loading||pendingProjects===0" @click="startTransfer">▶ Start</button>
          <button v-else class="btn bd" @click="stopTransfer">◼ Stop</button>
          <button class="btn bs" :disabled="running" @click="loadProjects">↻ Refresh</button>
        </div>
      </div>
    </header>

    <div class="tp-body">
      <!-- Stats -->
      <div class="stats">
        <div class="sc"><div class="sv">{{ totalProjects }}</div><div class="sl">Total</div></div>
        <div class="sc sp"><div class="sv">{{ pendingProjects }}</div><div class="sl">Pending</div></div>
        <div class="sc sd"><div class="sv">{{ doneProjects + sessionProcessed }}</div><div class="sl">Done</div></div>
        <div class="sc ss"><div class="sv">{{ sessionProcessed }}</div><div class="sl">This Session</div></div>
      </div>

      <!-- Progress -->
      <div v-if="running||sessionProcessed>0" class="prog">
        <div class="prog-top">
          <span v-if="currentProject" class="prog-cur">
            Currently: <a :href="currentProject.Project_Folder" target="_blank" class="prog-link">
              {{ currentProject.Customer_Address || currentProject.Project_ID }}
              <Icon name="lucide:external-link" size="12"/>
            </a>
          </span>
          <span v-else class="prog-cur">{{ stopped ? 'Stopped' : 'Complete' }}</span>
          <span class="prog-pct">{{ progressPct }}%</span>
        </div>
        <div class="prog-track"><div class="prog-fill" :class="{pulse:running}" :style="{width:progressPct+'%'}"/></div>
      </div>

      <!-- Live counters -->
      <div v-if="running" class="live-counts">
        <span class="lc lc-c">✅ {{ liveCopied }} copied</span>
        <span class="lc lc-s">⏭️ {{ liveSkipped }} skipped</span>
        <span class="lc lc-f">❌ {{ liveFailed }} failed</span>
      </div>

      <!-- Error -->
      <div v-if="error" class="err">{{ error }}</div>

      <!-- Loading -->
      <div v-if="loading" class="ld"><div class="spinner"/>Loading projects...</div>

      <!-- Live Log Terminal -->
      <div v-if="liveLog.length>0" class="terminal">
        <div class="term-hdr">
          <div class="term-dots"><span/><span/><span/></div>
          <span>Live Transfer Log</span>
        </div>
        <div ref="logBox" class="term-body">
          <div v-for="(l,i) in liveLog" :key="i" class="term-line" :class="{'term-sep':l.icon==='━'}">
            <span class="term-time">{{ l.time }}</span>
            <span class="term-icon">{{ l.icon }}</span>
            <span class="term-text" :style="{paddingLeft:(l.depth*12)+'px'}">{{ l.text }}</span>
          </div>
        </div>
      </div>

      <!-- Projects list -->
      <div v-if="!loading&&projects.length>0&&liveLog.length===0" class="plist">
        <h2>Projects ({{ pendingProjects }} pending of {{ totalProjects }})</h2>
        <div class="plist-box">
          <div v-for="p in projects.slice(0,200)" :key="p.Project_ID" class="prow" :class="{'pdone':p.isTransfered}">
            <span class="pdot" :class="p.isTransfered?'pdot-d':'pdot-p'"/>
            <span class="pid">{{ p.Project_ID }}</span>
            <span class="padr">{{ p.Customer_Address }}</span>
            <a v-if="p.Project_Folder" :href="p.Project_Folder" target="_blank" class="pflink"><Icon name="lucide:folder" size="14"/></a>
            <span v-if="p.isTransfered" class="ptag">transferred</span>
          </div>
          <div v-if="projects.length>200" class="pmore">...and {{ projects.length-200 }} more</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tp{min-height:100vh;background:#08080c;color:#e4e4e7;font-family:Inter,-apple-system,sans-serif}
.tp-hdr{background:linear-gradient(135deg,rgba(59,130,246,.07),rgba(139,92,246,.07));border-bottom:1px solid rgba(255,255,255,.05);padding:1rem 2rem}
.tp-hdr-in{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
.tp-hdr-left{display:flex;align-items:center;gap:.75rem}
.tp-icon{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff}
h1{font-size:1.15rem;font-weight:700;margin:0;color:#f4f4f5}
.tp-hdr-left p{font-size:.75rem;color:#52525b;margin:0}
.tp-hdr-acts{display:flex;gap:.5rem}
.tp-body{max-width:1200px;margin:0 auto;padding:1.5rem 2rem}

.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.45rem 1.1rem;border:none;border-radius:10px;font-size:.82rem;font-weight:600;cursor:pointer;transition:.2s}
.btn:disabled{opacity:.35;cursor:not-allowed}
.bp{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;box-shadow:0 0 20px rgba(59,130,246,.2)}
.bp:hover:not(:disabled){box-shadow:0 0 30px rgba(59,130,246,.4);transform:translateY(-1px)}
.bd{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff}
.bs{background:rgba(255,255,255,.05);color:#71717a;border:1px solid rgba(255,255,255,.08)}
.bs:hover:not(:disabled){background:rgba(255,255,255,.08);color:#fff}

.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;margin-bottom:1.5rem}
.sc{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);border-radius:14px;padding:1rem;text-align:center}
.sv{font-size:1.75rem;font-weight:800;color:#f4f4f5;font-variant-numeric:tabular-nums}
.sl{font-size:.65rem;color:#52525b;margin-top:.15rem;text-transform:uppercase;letter-spacing:.06em}
.sp .sv{color:#f59e0b}.sd .sv{color:#22c55e}.ss .sv{color:#3b82f6}

.prog{margin-bottom:1.25rem}
.prog-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem}
.prog-cur{font-size:.82rem;color:#a1a1aa}
.prog-link{color:#60a5fa;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:4px}
.prog-link:hover{text-decoration:underline;color:#93c5fd}
.prog-pct{font-size:1.4rem;font-weight:800;color:#3b82f6}
.prog-track{height:6px;background:rgba(255,255,255,.05);border-radius:6px;overflow:hidden}
.prog-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:6px;transition:width .4s}
.prog-fill.pulse{animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}

.live-counts{display:flex;gap:1.25rem;margin-bottom:1.25rem}
.lc{font-size:.8rem;padding:.3rem .75rem;border-radius:8px;font-weight:600;font-variant-numeric:tabular-nums}
.lc-c{background:rgba(34,197,94,.08);color:#4ade80}
.lc-s{background:rgba(234,179,8,.08);color:#facc15}
.lc-f{background:rgba(239,68,68,.08);color:#f87171}

.err{padding:.6rem 1rem;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.15);border-radius:10px;color:#fca5a5;font-size:.82rem;margin-bottom:1rem}
.ld{text-align:center;color:#52525b;font-size:.85rem;padding:3rem 0;display:flex;align-items:center;justify-content:center;gap:.6rem}
.spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,.08);border-top-color:#3b82f6;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* Terminal */
.terminal{background:#0c0c14;border:1px solid rgba(255,255,255,.06);border-radius:14px;overflow:hidden;margin-bottom:1.5rem}
.term-hdr{display:flex;align-items:center;gap:.6rem;padding:.55rem 1rem;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.04);font-size:.72rem;color:#52525b}
.term-dots{display:flex;gap:5px}
.term-dots span{width:10px;height:10px;border-radius:50%}
.term-dots span:nth-child(1){background:#ef4444}
.term-dots span:nth-child(2){background:#f59e0b}
.term-dots span:nth-child(3){background:#22c55e}
.term-body{max-height:550px;overflow-y:auto;padding:.5rem 0;font-family:'JetBrains Mono','Fira Code',monospace;font-size:.72rem;line-height:1.7}
.term-line{display:flex;align-items:flex-start;padding:0 1rem;gap:.5rem}
.term-line:hover{background:rgba(255,255,255,.02)}
.term-sep{margin:.4rem 0;color:#3b82f6!important;font-weight:700}
.term-sep .term-text{color:#60a5fa;font-weight:700}
.term-time{color:#3f3f46;min-width:62px;flex-shrink:0}
.term-icon{flex-shrink:0;width:18px;text-align:center}
.term-text{color:#a1a1aa;white-space:pre-wrap;word-break:break-all}

/* Projects list */
.plist h2{font-size:.9rem;font-weight:600;color:#71717a;margin-bottom:.6rem}
.plist-box{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:12px;overflow:hidden;max-height:500px;overflow-y:auto}
.prow{display:flex;align-items:center;gap:.6rem;padding:.4rem 1rem;border-top:1px solid rgba(255,255,255,.03);font-size:.78rem}
.prow:first-child{border-top:none}
.pdone{opacity:.35}
.pdot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.pdot-d{background:#22c55e}.pdot-p{background:#f59e0b}
.pid{width:100px;color:#52525b;font-variant-numeric:tabular-nums}
.padr{flex:1;color:#d4d4d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pflink{color:#3b82f6;display:flex;align-items:center;opacity:.5;transition:.2s}
.pflink:hover{opacity:1}
.ptag{font-size:.6rem;padding:.1rem .4rem;border-radius:5px;background:rgba(34,197,94,.08);color:#4ade80}
.pmore{text-align:center;padding:.5rem;color:#3f3f46;font-size:.75rem}
</style>
