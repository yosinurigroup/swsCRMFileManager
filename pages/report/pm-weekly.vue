<script setup lang="ts">
import { useSavedReports, REPORT_ICONS } from '~/composables/useSavedReports'
useHead({ title: 'PM Weekly Report' })

// Dark/light mode
const colorMode = useColorMode()
function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

const session = ref<any>({ authenticated: false })
const projects = ref<any[]>([])
const notes = ref<any[]>([])
const filterOptions = ref<any>({})
const filterCounts = ref<Record<string, Record<string, number>>>({})
const userNameMap = ref<Record<string, string>>({})
const salesRepMap = ref<Record<string, string>>({})
const totalCount = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(true)
const search = ref('')
const sidebarOpen = ref(true)

// Filters — reactive, auto-fetch on change
const dateOf = ref('SSA')
const dateFrom = ref('')
const dateTo = ref('')
const branch = ref('')
const vendor = ref('')
const salesRep = ref('')
const projectType = ref('')
const jobStatus = ref('')
const projectStatus = ref('')
const projectManager = ref('')
const financeManager = ref('')
const engineer = ref('')
const permitCoordinator = ref('')
const utility = ref('')
const solarEquipment = ref('')
const ssaStatus = ref('')
const solarInstallStatus = ref('')
const completionStatus = ref('')
const finalStatus = ref('')

const dateOfOptions = ['SSA','Solar Install','MPU Install','Battery Install','Completion','Final','Start-up / Monitor']

// Name resolution: email → display name, or sales rep ID → name
function resolveName(val: string): string {
  if (!val) return ''
  return userNameMap.value[val.toLowerCase()] || val
}
function resolveSalesRep(id: string): string {
  if (!id) return ''
  return salesRepMap.value[id] || id
}

// Build dropdown items with labels
const emailFields = ['projectManagers','financeManagers','engineers','permitCoordinators']
function dropdownItems(key: string): {value: string, label: string}[] {
  const raw: string[] = filterOptions.value[key] || []
  if (key === 'salesReps') {
    return raw.map(v => ({ value: v, label: resolveSalesRep(v) }))
  }
  if (emailFields.includes(key)) {
    return raw.map(v => ({ value: v, label: resolveName(v) }))
  }
  return raw.map(v => ({ value: v, label: v }))
}

onMounted(async () => {
  try {
    const [s, opts, usersData, salesRepsData] = await Promise.all([
      $fetch<any>('/api/auth/session'),
      $fetch<any>('/api/bq/filter-options'),
      $fetch<any>('/api/bq/users'),
      $fetch<any>('/api/bq/sales-reps'),
    ])
    session.value = s
    filterOptions.value = opts

    // Build user name map (email → name)
    const users: any[] = usersData.users || []
    const map: Record<string, string> = {}
    for (const u of users) {
      if (u.Email) {
        const name = [u['First Name'], u['Last Name']].filter(Boolean).join(' ') || u.Email
        map[u.Email.toLowerCase()] = name
      }
    }
    userNameMap.value = map

    // Build sales rep map (Row ID → name)
    const reps: any[] = salesRepsData.salesReps || []
    const srMap: Record<string, string> = {}
    for (const r of reps) {
      const id = r['Row ID'] || ''
      if (id) {
        srMap[id] = [r['First Name'], r['Last Name']].filter(Boolean).join(' ') || id
      }
    }
    salesRepMap.value = srMap

    await fetchProjects()
  } catch (e) { console.error(e) }
})

// Debounced auto-fetch on filter change
let _debounce: any = null
watch([dateOf, dateFrom, dateTo, branch, vendor, salesRep, projectType, jobStatus, projectStatus, projectManager, financeManager, engineer, permitCoordinator, utility, solarEquipment, ssaStatus, solarInstallStatus, completionStatus, finalStatus], () => {
  clearTimeout(_debounce)
  _debounce = setTimeout(() => fetchProjects(), 300)
})

const PAGE_SIZE = 100

function buildParams(): Record<string, string> {
  const params: Record<string, string> = {}
  if (dateOf.value && dateFrom.value && dateTo.value) {
    params.dateOf = dateOf.value; params.dateFrom = dateFrom.value; params.dateTo = dateTo.value
  }
  if (branch.value) params.branch = branch.value
  if (vendor.value) params.vendor = vendor.value
  if (salesRep.value) params.salesRep = salesRep.value
  if (projectType.value) params.projectType = projectType.value
  if (jobStatus.value) params.jobStatus = jobStatus.value
  if (projectStatus.value) params.projectStatus = projectStatus.value
  if (projectManager.value) params.projectManager = projectManager.value
  if (financeManager.value) params.financeManager = financeManager.value
  if (engineer.value) params.engineer = engineer.value
  if (permitCoordinator.value) params.permitCoordinator = permitCoordinator.value
  if (utility.value) params.utility = utility.value
  if (solarEquipment.value) params.solarEquipment = solarEquipment.value
  if (ssaStatus.value) params.ssaStatus = ssaStatus.value
  if (solarInstallStatus.value) params.solarInstallStatus = solarInstallStatus.value
  if (completionStatus.value) params.completionStatus = completionStatus.value
  if (finalStatus.value) params.finalStatus = finalStatus.value
  return params
}

async function fetchFilterCounts() {
  try {
    const params = buildParams()
    const data = await $fetch<any>('/api/bq/filter-counts', { params })
    filterCounts.value = data || {}
  } catch (e) { console.error('filter-counts error:', e) }
}

async function fetchProjects() {
  loading.value = true
  try {
    const params = buildParams()
    params.limit = String(PAGE_SIZE)
    params.offset = '0'
    const [r] = await Promise.all([
      $fetch<any>('/api/bq/projects', { params }),
      fetchFilterCounts(),
    ])
    projects.value = r.projects || []
    totalCount.value = r.total || 0
    hasMore.value = projects.value.length < totalCount.value
    await fetchNotes()
  } catch (e) { console.error(e) } finally { loading.value = false }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const params = buildParams()
    params.limit = String(PAGE_SIZE)
    params.offset = String(projects.value.length)
    const r = await $fetch<any>('/api/bq/projects', { params })
    const newRows = r.projects || []
    projects.value = [...projects.value, ...newRows]
    hasMore.value = projects.value.length < totalCount.value
    // Fetch notes for new rows
    const newIds = newRows.map((p: any) => p['Project ID']).filter(Boolean)
    if (newIds.length) {
      const nr = await $fetch<any>('/api/bq/notes', { params: { projectIds: newIds.join(',') } })
      notes.value = [...notes.value, ...(nr.notes || [])]
    }
  } catch (e) { console.error(e) } finally { loadingMore.value = false }
}

async function fetchNotes() {
  const ids = projects.value.map((p: any) => p['Project ID']).filter(Boolean)
  if (!ids.length) { notes.value = []; return }
  try {
    const r = await $fetch<any>('/api/bq/notes', { params: { projectIds: ids.join(',') } })
    notes.value = r.notes || []
  } catch {}
}

function resetFilters() {
  dateOf.value = 'SSA'; dateFrom.value = ''; dateTo.value = ''
  branch.value = ''; vendor.value = ''; salesRep.value = ''; projectType.value = ''
  jobStatus.value = ''; projectStatus.value = ''
  projectManager.value = ''; financeManager.value = ''; engineer.value = ''
  permitCoordinator.value = ''; utility.value = ''; solarEquipment.value = ''
  ssaStatus.value = ''; solarInstallStatus.value = ''; completionStatus.value = ''; finalStatus.value = ''
}

// Helpers
function fmtDate(v: any): string {
  if (!v) return ''
  try { const d = new Date(v?.value || v); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month:'numeric', day:'numeric', year:'numeric' }) } catch { return '' }
}

// Format note date as MM/DD/YYYY from Time Stamp (date part only)
function fmtNoteDate(v: any): string {
  if (!v) return ''
  try {
    const raw = v?.value || v
    const d = new Date(raw)
    if (isNaN(d.getTime())) return ''
    return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`
  } catch { return '' }
}

// Notes: SORT ascending (oldest first) matching AppSheet SORT(Select(Notes[Date], [ProjectId]...))
// Format: date(TimeStamp) - Note
const notesMapCache = computed(() => {
  const map: Record<string, string> = {}
  // Group notes by ProjectId
  const grouped: Record<string, any[]> = {}
  for (const n of notes.value) {
    const pid = n.ProjectId
    if (!pid || !n.Note?.trim()) continue
    if (!grouped[pid]) grouped[pid] = []
    grouped[pid].push(n)
  }
  // Sort each group ascending by Time Stamp (oldest first = AppSheet SORT default)
  for (const pid of Object.keys(grouped)) {
    const entries = grouped[pid]
    if (!entries) continue
    entries.sort((a: any, b: any) => {
      const da = new Date(a['Time Stamp']?.value || a['Time Stamp'] || 0).getTime()
      const db = new Date(b['Time Stamp']?.value || b['Time Stamp'] || 0).getTime()
      return da - db  // ascending = oldest first
    })
    map[pid] = entries.map((n: any) => {
      const d = fmtNoteDate(n['Time Stamp'])
      return d ? `${d} - ${n.Note.trim()}` : n.Note.trim()
    }).join('\n')
  }
  return map
})

function getNotesForProject(pid: string): string {
  if (!pid) return ''
  return notesMapCache.value[pid] || ''
}

const filtered = computed(() => {
  if (!search.value) return projects.value
  const q = search.value.toLowerCase()
  return projects.value.filter((p: any) =>
    [p['Customer Address'], p['Job Status'], p['Project Status'], p['Sales Rep'], p['Branch Name']].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
  )
})

const summary = computed(() => {
  const total = totalCount.value
  const loaded = filtered.value
  const completed = loaded.filter((p: any) => (p['Project Status']||'').toLowerCase().includes('complete')).length
  const cancelled = loaded.filter((p: any) => (p['Job Status']||'').toLowerCase().includes('cancel')).length
  return { total, completed, cancelled, active: loaded.length - completed - cancelled }
})

// Chip CSS class (darker backgrounds)
function chipClass(val: string, type: 'job'|'project'): string {
  const s = (val||'').toLowerCase()
  if (type === 'job') {
    if (s.includes('cancel')) return 'chip-red'
    if (s.includes('closed')) return 'chip-green'
    return 'chip-blue'
  }
  if (s.includes('complete')) return 'chip-green'
  if (s.includes('pending')) return 'chip-amber'
  if (s.includes('no ')) return 'chip-red'
  return 'chip-amber'
}

// Infinite scroll
const tableContainerRef = ref<HTMLElement | null>(null)
function onTableScroll() {
  const el = tableContainerRef.value
  if (!el || loadingMore.value || !hasMore.value) return
  const { scrollTop, scrollHeight, clientHeight } = el
  if (scrollTop + clientHeight >= scrollHeight - 200) {
    loadMore()
  }
}

function downloadPDF() {
  const rows = filtered.value
  const today = new Date()
  const reportDate = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}-${today.getFullYear()}`
  const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const tableRows = rows.map((p: any) => {
    const pid = p['Project ID'] || ''
    const pn = getNotesForProject(pid)
    return `<tr><td>${esc(p['Customer Address']||'—')}</td><td>${esc(p['Job Status']||'')}</td><td>${esc(p['Project Status']||'')}</td><td>${fmtDate(p.SSA)||esc(p['SSA Status']||'')}</td><td>${fmtDate(p['Solar Install'])||esc(p['Solar Install Status']||'')}</td><td>${fmtDate(p['Final Date'])||esc(p['Final Status']||'')}</td><td>${fmtDate(p['PTO Received'])||esc(p['PTO Status']||'')}</td><td>${fmtDate(p['Start-Up Monitor']||p['Completion Date'])||''}</td><td class="notes-cell">${pn?`<div class="nc">${esc(pn).replace(/\n/g,'<br>')}</div>`:''}</td></tr>`
  }).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PM Weekly Report</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;padding:30px 40px;color:#111;font-size:11px}h1{font-size:18px;font-weight:700;margin-bottom:4px}.sub{font-size:12px;font-weight:600;margin-bottom:2px}.rd{font-size:11px;margin-bottom:16px}table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#f4f6f8;font-weight:600;font-size:10px;text-align:left;padding:6px 8px;border:1px solid #d0d5dd;white-space:nowrap}td{padding:5px 8px;border:1px solid #d0d5dd;font-size:10px;vertical-align:top}tr:nth-child(even){background:#fafbfc}.notes-cell{max-width:280px}.nc{font-size:9px;line-height:1.4;color:#333;white-space:pre-line}@media print{body{padding:20px}@page{size:landscape;margin:12mm}}</style></head><body><h1>Project Weekly Report ${session.value.name||''}</h1><p class="rd">Report Date: ${reportDate} • Total: ${rows.length} projects</p><table><thead><tr><th style="min-width:160px">Project Address</th><th>Job Status</th><th>Project Status</th><th>SSA</th><th>Solar Install</th><th>Final</th><th>PTO</th><th>Start-Up / Monitor</th><th style="min-width:200px">Project Notes</th></tr></thead><tbody>${tableRows}</tbody></table></body></html>`
  const w = window.open('','_blank')
  if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400) }
}

// Filter config
const filterDefs = [
  { model: 'branch', label: 'Branch', key: 'branches', icon: 'i-lucide-git-branch' },
  { model: 'salesRep', label: 'Sales Rep', key: 'salesReps', icon: 'i-lucide-user' },
  { model: 'jobStatus', label: 'Job Status', key: 'jobStatuses', icon: 'i-lucide-briefcase' },
  { model: 'projectStatus', label: 'Project Status', key: 'projectStatuses', icon: 'i-lucide-activity' },
  { model: 'projectManager', label: 'Project Manager', key: 'projectManagers', icon: 'i-lucide-user-cog' },
  { model: 'financeManager', label: 'Finance Manager', key: 'financeManagers', icon: 'i-lucide-landmark' },
  { model: 'engineer', label: 'Engineer', key: 'engineers', icon: 'i-lucide-hard-hat' },
  { model: 'permitCoordinator', label: 'Permit Coordinator', key: 'permitCoordinators', icon: 'i-lucide-file-check' },
  { model: 'utility', label: 'Utility', key: 'utilities', icon: 'i-lucide-zap' },
  { model: 'projectType', label: 'Project Type', key: 'projectTypes', icon: 'i-lucide-folder' },
  { model: 'solarEquipment', label: 'Solar Equipment', key: 'solarEquipment', icon: 'i-lucide-sun' },
  { model: 'ssaStatus', label: 'SSA Status', key: 'ssaStatuses', icon: 'i-lucide-check-circle' },
  { model: 'solarInstallStatus', label: 'Solar Install Status', key: 'solarInstallStatuses', icon: 'i-lucide-wrench' },
  { model: 'completionStatus', label: 'Completion Status', key: 'completionStatuses', icon: 'i-lucide-flag' },
  { model: 'finalStatus', label: 'Final Status', key: 'finalStatuses', icon: 'i-lucide-check-square' },
]

// v-model helpers
const filterModels: Record<string, any> = {
  branch, vendor, salesRep, projectType, jobStatus, projectStatus,
  projectManager, financeManager, engineer, permitCoordinator,
  utility, solarEquipment, ssaStatus, solarInstallStatus, completionStatus, finalStatus,
}

// Searchable dropdown state
const openDropdown = ref<string | null>(null)
const dropdownSearches = ref<Record<string, string>>({})

function toggleDropdown(model: string) {
  if (openDropdown.value === model) {
    openDropdown.value = null
  } else {
    openDropdown.value = model
    dropdownSearches.value[model] = ''
  }
}

function selectItem(model: string, value: string) {
  filterModels[model].value = filterModels[model].value === value ? '' : value
  openDropdown.value = null
}

function getFilteredItems(f: typeof filterDefs[0]): {value: string, label: string}[] {
  const items = dropdownItems(f.key)
  const q = (dropdownSearches.value[f.model] || '').toLowerCase()
  if (!q) return items
  return items.filter(i => i.label.toLowerCase().includes(q))
}

function getSelectedLabel(f: typeof filterDefs[0]): string {
  const val = filterModels[f.model].value
  if (!val) return 'All'
  const items = dropdownItems(f.key)
  const found = items.find(i => i.value === val)
  return found ? found.label : val
}

// Map filter model → filterCounts key
const filterCountsKeyMap: Record<string, string> = {
  branch: 'branches', vendor: 'vendors', salesRep: 'salesReps',
  projectType: 'projectTypes', projectManager: 'projectManagers',
  financeManager: 'financeManagers', engineer: 'engineers',
  permitCoordinator: 'permitCoordinators', utility: 'utilities',
  solarEquipment: 'solarEquipment', jobStatus: 'jobStatuses',
  projectStatus: 'projectStatuses', ssaStatus: 'ssaStatuses',
  solarInstallStatus: 'solarInstallStatuses', completionStatus: 'completionStatuses',
  finalStatus: 'finalStatuses',
}
// Status fields: values are split by comma/slash, so sum all matching DB values
const likeFields = new Set(['jobStatus','projectStatus','ssaStatus','solarInstallStatus','completionStatus','finalStatus'])

function getOptionCount(model: string, optionValue: string): number {
  const key = filterCountsKeyMap[model]
  if (!key) return 0
  const countsMap = filterCounts.value[key] || {}
  const needle = optionValue.toLowerCase()
  if (likeFields.has(model)) {
    // Sum all DB entries that contain this value
    let total = 0
    for (const [dbVal, cnt] of Object.entries(countsMap)) {
      if (dbVal.toLowerCase().includes(needle)) total += cnt
    }
    return total
  }
  // Exact match (case-insensitive)
  for (const [dbVal, cnt] of Object.entries(countsMap)) {
    if (dbVal.toLowerCase() === needle) return cnt
  }
  return 0
}

// Click outside or Escape to close
const sidebarRef = ref<HTMLElement | null>(null)
onMounted(() => {
  document.addEventListener('click', (e: MouseEvent) => {
    if (openDropdown.value && sidebarRef.value && !sidebarRef.value.contains(e.target as Node)) {
      openDropdown.value = null
    }
  })
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && openDropdown.value) {
      openDropdown.value = null
    }
  })
})

// ── Saved Reports ────────────────────────────────────────────────────────────
const { list: _srList, listSync: _srListSync, save: _srSave, remove: _srRemove, update: _srUpdate } = useSavedReports('pmweekly')
const savedReports = ref<any[]>([])
const showSaveModal = ref(false)
const showLoadModal = ref(false)
const saveName = ref('')
const saveIcon = ref('📋')
const activeReportId = ref<string | null>(null)
const deleteConfirmId = ref<string | null>(null)
const savedReportSearch = ref('')
const editingReportId = ref<string | null>(null)
const editingName = ref('')

function srUser() { return session.value.email || session.value.name || 'guest' }

async function refreshSavedReports() {
  // Show cached data instantly (sync), then replace with fresh BQ data (async)
  savedReports.value = _srListSync(srUser())
  savedReports.value = await _srList(srUser())
}

watch(() => session.value.name, () => refreshSavedReports(), { immediate: true })

function getCurrentFilters() {
  return {
    dateOf: dateOf.value, dateFrom: dateFrom.value, dateTo: dateTo.value,
    branch: branch.value, vendor: vendor.value, salesRep: salesRep.value,
    projectType: projectType.value, jobStatus: jobStatus.value, projectStatus: projectStatus.value,
    projectManager: projectManager.value, financeManager: financeManager.value,
    engineer: engineer.value, permitCoordinator: permitCoordinator.value,
    utility: utility.value, solarEquipment: solarEquipment.value,
    ssaStatus: ssaStatus.value, solarInstallStatus: solarInstallStatus.value,
    completionStatus: completionStatus.value, finalStatus: finalStatus.value,
    search: search.value,
  }
}

function getFilterLabels(filters: any): string[] {
  const out: string[] = []
  if (filters.dateFrom && filters.dateTo) out.push(`${filters.dateOf}: ${filters.dateFrom} → ${filters.dateTo}`)
  if (filters.branch) out.push(`Branch: ${filters.branch}`)
  if (filters.salesRep) out.push('Sales Rep')
  if (filters.vendor) out.push('Vendor')
  if (filters.jobStatus) out.push(`Job: ${filters.jobStatus}`)
  if (filters.projectStatus) out.push(`Status: ${filters.projectStatus}`)
  if (filters.projectType) out.push(`Type: ${filters.projectType}`)
  if (filters.projectManager) out.push('Project Manager')
  if (filters.financeManager) out.push('Finance Manager')
  if (filters.engineer) out.push('Engineer')
  if (filters.permitCoordinator) out.push('Permit')
  if (filters.utility) out.push(`Utility: ${filters.utility}`)
  if (filters.solarEquipment) out.push('Solar Equipment')
  if (filters.ssaStatus) out.push(`SSA: ${filters.ssaStatus}`)
  if (filters.solarInstallStatus) out.push(`Solar: ${filters.solarInstallStatus}`)
  if (filters.completionStatus) out.push(`Completion: ${filters.completionStatus}`)
  if (filters.finalStatus) out.push(`Final: ${filters.finalStatus}`)
  if (filters.search) out.push(`"${filters.search}"`)
  return out
}

function openSaveModal() {
  saveName.value = ''
  saveIcon.value = '📋'
  showSaveModal.value = true
}

async function doSaveReport() {
  if (!saveName.value.trim()) return
  const tmpl: any = {
    id: Date.now().toString(),
    name: saveName.value.trim(),
    icon: saveIcon.value,
    createdAt: new Date().toISOString(),
    filters: getCurrentFilters(),
  }
  await _srSave(tmpl, srUser())
  activeReportId.value = tmpl.id
  showSaveModal.value = false
  await refreshSavedReports()
}

function applyReport(report: any) {
  const f = report.filters || {}
  dateOf.value = f.dateOf || 'SSA'
  dateFrom.value = f.dateFrom || ''
  dateTo.value = f.dateTo || ''
  branch.value = f.branch || ''
  vendor.value = f.vendor || ''
  salesRep.value = f.salesRep || ''
  projectType.value = f.projectType || ''
  jobStatus.value = f.jobStatus || ''
  projectStatus.value = f.projectStatus || ''
  projectManager.value = f.projectManager || ''
  financeManager.value = f.financeManager || ''
  engineer.value = f.engineer || ''
  permitCoordinator.value = f.permitCoordinator || ''
  utility.value = f.utility || ''
  solarEquipment.value = f.solarEquipment || ''
  ssaStatus.value = f.ssaStatus || ''
  solarInstallStatus.value = f.solarInstallStatus || ''
  completionStatus.value = f.completionStatus || ''
  finalStatus.value = f.finalStatus || ''
  search.value = f.search || ''
  activeReportId.value = report.id
  showLoadModal.value = false
}

async function doDeleteReport(id: string) {
  await _srRemove(id, srUser())
  if (activeReportId.value === id) activeReportId.value = null
  deleteConfirmId.value = null
  savedReports.value = savedReports.value.filter((r: any) => r.id !== id)
  refreshSavedReports()
}

function startEditName(report: any) {
  editingReportId.value = report.id
  editingName.value = report.name
}

async function confirmEditName(report: any) {
  if (!editingName.value.trim()) return
  await _srUpdate(report.id, { name: editingName.value.trim() }, srUser())
  editingReportId.value = null
  await refreshSavedReports()
}

const filteredSavedReports = computed(() => {
  if (!savedReportSearch.value) return savedReports.value
  const q = savedReportSearch.value.toLowerCase()
  return savedReports.value.filter((r: any) => r.name.toLowerCase().includes(q))
})

const activeReport = computed(() => savedReports.value.find((r: any) => r.id === activeReportId.value) || null)
</script>

<template>
  <div class="h-screen flex flex-col" style="background:var(--surface-primary);color:var(--text-primary)">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-3 shrink-0" style="border-bottom:1px solid var(--border-subtle);background:var(--surface-card)">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#1da462,#0f7b3f)">
          <Icon name="i-lucide-calendar-range" class="w-4 h-4 text-white"/>
        </div>
        <div>
          <h1 class="text-sm font-bold">PM Weekly Report <span v-if="session.name" style="color:var(--text-secondary)">— {{session.name}}</span></h1>
          <p class="text-[11px]" style="color:var(--text-tertiary)">Report Date: {{new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium" style="color:var(--text-tertiary)">{{totalCount.toLocaleString()}} projects</span>
        <div v-if="activeReport" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold" style="background:color-mix(in srgb,var(--drive-green) 15%,transparent);border:1px solid var(--drive-green);color:var(--drive-green)">
          <span>{{activeReport.icon}}</span>
          <span>{{activeReport.name}}</span>
          <button @click="activeReportId=null"><Icon name="i-lucide-x" class="w-3 h-3"/></button>
        </div>
        <button class="btn-icon flex items-center gap-1.5 px-3" style="height:32px;font-size:12px;font-weight:600" @click="openSaveModal">
          <Icon name="i-lucide-bookmark-plus" class="w-3.5 h-3.5" style="color:var(--drive-green)"/>
          <span class="hidden sm:inline" style="color:var(--text-primary)">Save</span>
        </button>
        <button class="btn-icon flex items-center gap-1.5 px-3 relative" style="height:32px;font-size:12px;font-weight:600" @click="showLoadModal=true;savedReportSearch=''">
          <Icon name="i-lucide-folder-open" class="w-3.5 h-3.5" style="color:#8b5cf6"/>
          <span class="hidden sm:inline" style="color:var(--text-primary)">Reports</span>
          <span v-if="savedReports.length" class="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style="background:#8b5cf6">{{savedReports.length}}</span>
        </button>
        <div class="w-px h-5 mx-1" style="background:var(--border-subtle)"/>
        <button class="btn-primary" @click="downloadPDF"><Icon name="i-lucide-download" class="w-3.5 h-3.5"/>Download PDF</button>
        <button class="btn-icon" style="width:32px;height:32px;border-radius:8px" title="Toggle theme" @click="toggleTheme">
          <Icon :name="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="w-4 h-4"/>
        </button>
        <div v-if="session.authenticated" class="flex items-center gap-2 pl-2 ml-1" style="border-left:1px solid var(--border-subtle)">
          <div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style="background:linear-gradient(135deg,#1da462,#0f7b3f)">
            {{(session.name||'U').charAt(0).toUpperCase()}}
          </div>
          <p class="text-xs font-semibold hidden sm:block">{{session.name}}</p>
        </div>
      </div>
    </div>

    <div class="flex flex-1 min-h-0 overflow-hidden">
      <!-- Sidebar Filters -->
      <div ref="sidebarRef" class="shrink-0 flex flex-col min-h-0 transition-all duration-200 overflow-hidden" :style="{width: sidebarOpen ? '300px' : '40px', borderRight: '1px solid var(--border-subtle)', background: 'var(--surface-card)'}">
        <div class="flex items-center gap-2 px-3 py-3 shrink-0" style="border-bottom:1px solid var(--border-subtle)">
          <template v-if="sidebarOpen">
            <Icon name="i-lucide-sliders-horizontal" class="w-3.5 h-3.5" style="color:var(--drive-green)"/>
            <span class="text-xs font-semibold">Filters</span>
          </template>
          <div class="ml-auto flex gap-1">
            <button v-if="sidebarOpen" class="btn-icon" style="width:24px;height:24px" title="Reset filters" @click="resetFilters"><Icon name="i-lucide-rotate-ccw" class="w-3 h-3" style="color:#ef4444"/></button>
            <button class="btn-icon" style="width:24px;height:24px" @click="sidebarOpen=!sidebarOpen"><Icon :name="sidebarOpen?'i-lucide-panel-left-close':'i-lucide-panel-left-open'" class="w-3 h-3"/></button>
          </div>
        </div>

        <div v-if="sidebarOpen" class="flex-1 overflow-y-auto px-3 pt-3 pb-8 space-y-4">
          <!-- Search -->
          <div class="relative">
            <Icon name="i-lucide-search" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style="color:var(--text-tertiary)"/>
            <input v-model="search" class="input-base w-full" style="height:34px;font-size:12px;padding-left:30px" placeholder="Search projects...">
          </div>

          <div class="h-px" style="background:var(--border-subtle)"/>
          <p class="text-[10px] font-semibold uppercase tracking-wider" style="color:var(--text-tertiary)">Filters</p>

          <!-- Date Of -->
          <div class="space-y-1.5">
            <label class="text-[11px] font-medium flex items-center gap-1.5" style="color:var(--text-secondary)">
              <Icon name="i-lucide-calendar" class="w-3 h-3"/>Date of
            </label>
            <div class="relative">
              <button type="button" class="filter-trigger filter-active" @click.stop="toggleDropdown('_dateOf')">
                <span class="truncate">{{ dateOf }}</span>
                <Icon name="i-lucide-chevron-down" class="w-3 h-3 shrink-0 transition-transform" :style="{transform: openDropdown === '_dateOf' ? 'rotate(180deg)' : ''}"/>
              </button>
              <div v-if="openDropdown === '_dateOf'" class="filter-dropdown" @click.stop>
                <div class="max-h-[220px] overflow-y-auto py-1">
                  <button v-for="o in dateOfOptions" :key="o" class="filter-option" :class="{'filter-option-selected': dateOf === o}" @click="dateOf = o; openDropdown = null">
                    <Icon :name="dateOf === o ? 'i-lucide-check' : 'i-lucide-circle'" class="w-3.5 h-3.5 shrink-0" :style="{color: dateOf === o ? 'var(--drive-green)' : 'var(--text-tertiary)', opacity: dateOf === o ? 1 : 0.3}"/>
                    <span>{{ o }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="space-y-1">
              <label class="text-[11px] font-medium flex items-center gap-1.5" style="color:var(--text-secondary)">
                <Icon name="i-lucide-calendar" class="w-3 h-3"/>From
              </label>
              <input v-model="dateFrom" type="date" class="input-base w-full" style="height:34px;font-size:11px">
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-medium flex items-center gap-1.5" style="color:var(--text-secondary)">
                <Icon name="i-lucide-calendar-check" class="w-3 h-3"/>To
              </label>
              <input v-model="dateTo" type="date" class="input-base w-full" style="height:34px;font-size:11px">
            </div>
          </div>

          <!-- Searchable filter dropdowns -->
          <div v-for="f in filterDefs" :key="f.model" class="space-y-1.5">
            <label class="text-[11px] font-medium flex items-center gap-1.5" style="color:var(--text-secondary)">
              <Icon :name="f.icon" class="w-3 h-3"/>{{f.label}}
            </label>
            <div class="relative">
              <!-- Trigger -->
              <button
                type="button"
                class="filter-trigger"
                :class="{'filter-active': filterModels[f.model].value}"
                @click.stop="toggleDropdown(f.model)"
              >
                <span class="truncate">{{ getSelectedLabel(f) }}</span>
                <Icon name="i-lucide-chevron-down" class="w-3 h-3 shrink-0 transition-transform" :style="{transform: openDropdown === f.model ? 'rotate(180deg)' : ''}"/>
              </button>

              <!-- Dropdown panel -->
              <div
                v-if="openDropdown === f.model"
                class="filter-dropdown"
                @click.stop
              >
                <!-- Search inside dropdown -->
                <div class="p-1.5" style="border-bottom:1px solid var(--border-subtle)">
                  <div class="relative">
                    <Icon name="i-lucide-search" class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style="color:var(--text-tertiary)"/>
                    <input
                      v-model="dropdownSearches[f.model]"
                      class="w-full text-xs outline-none pl-7 pr-2 py-1.5 rounded"
                      style="background:var(--surface-elevated);color:var(--text-primary);border:none"
                      :placeholder="`Search ${f.label.toLowerCase()}...`"
                      @click.stop
                    >
                  </div>
                </div>
                <!-- Options -->
                <div class="max-h-[220px] overflow-y-auto py-1">
                  <!-- All option -->
                  <button
                    class="filter-option"
                    :class="{'filter-option-selected': !filterModels[f.model].value}"
                    @click="selectItem(f.model, '')"
                  >
                    <Icon :name="!filterModels[f.model].value ? 'i-lucide-check' : 'i-lucide-circle'" class="w-3.5 h-3.5 shrink-0" :style="{color: !filterModels[f.model].value ? 'var(--drive-green)' : 'var(--text-tertiary)', opacity: !filterModels[f.model].value ? 1 : 0.3}"/>
                    <span>All</span>
                  </button>
                  <button
                    v-for="item in getFilteredItems(f)"
                    :key="item.value"
                    class="filter-option"
                    :class="{'filter-option-selected': filterModels[f.model].value === item.value}"
                    @click="selectItem(f.model, item.value)"
                  >
                    <Icon :name="filterModels[f.model].value === item.value ? 'i-lucide-check' : 'i-lucide-circle'" class="w-3.5 h-3.5 shrink-0" :style="{color: filterModels[f.model].value === item.value ? 'var(--drive-green)' : 'var(--text-tertiary)', opacity: filterModels[f.model].value === item.value ? 1 : 0.3}"/>
                    <span class="truncate">{{ item.label }}</span>
                    <span class="text-[9px] ml-auto shrink-0 tabular-nums" style="color:var(--text-tertiary)">{{ getOptionCount(f.model, item.value) }}</span>
                  </button>
                  <p v-if="getFilteredItems(f).length === 0" class="px-3 py-2 text-[11px]" style="color:var(--text-tertiary)">No results</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Table -->
      <div ref="tableContainerRef" class="flex-1 min-w-0 min-h-0 overflow-auto" @scroll="onTableScroll">
        <div v-if="loading" class="flex items-center justify-center h-full">
          <Icon name="i-lucide-loader-2" class="w-8 h-8 animate-spin" style="color:var(--text-tertiary)"/>
        </div>
        <table v-else class="w-full text-sm" style="border-collapse:collapse">
          <thead class="sticky top-0 z-10">
            <tr style="background:var(--surface-card)">
              <th class="text-left text-[11px] font-semibold px-2 py-2 whitespace-nowrap" style="border-bottom:1px solid var(--border-subtle);color:var(--text-secondary);min-width:340px">Project Address</th>
              <th class="text-left text-[11px] font-semibold px-2 py-2 whitespace-nowrap" style="border-bottom:1px solid var(--border-subtle);color:var(--text-secondary);width:90px">Job Status</th>
              <th class="text-left text-[11px] font-semibold px-2 py-2 whitespace-nowrap" style="border-bottom:1px solid var(--border-subtle);color:var(--text-secondary);width:130px">Project Status</th>
              <th v-for="h in ['SSA','Solar Install','Final','PTO','Start-Up / Monitor']" :key="h" class="text-left text-[11px] font-semibold px-2 py-2 whitespace-nowrap" style="border-bottom:1px solid var(--border-subtle);color:var(--text-secondary)">{{h}}</th>
              <th class="text-left text-[11px] font-semibold px-2 py-2 whitespace-nowrap" style="border-bottom:1px solid var(--border-subtle);color:var(--text-secondary);min-width:280px">Project Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in filtered" :key="p['Project ID']||i" class="transition-colors" style="border-bottom:1px solid var(--border-subtle)" :style="{'background': i%2===0 ? 'transparent' : 'var(--surface-card)'}">
              <td class="px-2 py-1.5 text-xs" style="color:var(--text-primary);min-width:340px">{{p['Customer Address']||'—'}}</td>
              <td class="px-2 py-1.5 text-xs whitespace-nowrap"><span v-if="p['Job Status']" class="status-chip" :class="chipClass(p['Job Status'],'job')">{{p['Job Status']}}</span><span v-else style="color:var(--text-tertiary)">—</span></td>
              <td class="px-2 py-1.5 text-xs" style="width:130px"><span v-if="p['Project Status']" class="status-chip" :class="chipClass(p['Project Status'],'project')" v-html="p['Project Status'].replace(/\s*,\s*|\s+\/\s+/g, '<br>')"></span><span v-else style="color:var(--text-tertiary)">—</span></td>
              <td class="px-2 py-1.5 text-xs whitespace-nowrap" style="color:var(--text-secondary)">{{fmtDate(p.SSA)||p['SSA Status']||'—'}}</td>
              <td class="px-2 py-1.5 text-xs whitespace-nowrap" style="color:var(--text-secondary)">{{fmtDate(p['Solar Install'])||p['Solar Install Status']||'—'}}</td>
              <td class="px-2 py-1.5 text-xs whitespace-nowrap" style="color:var(--text-secondary)">{{fmtDate(p['Final Date'])||p['Final Status']||'—'}}</td>
              <td class="px-2 py-1.5 text-xs whitespace-nowrap" style="color:var(--text-secondary)">{{fmtDate(p['PTO Received'])||p['PTO Status']||'—'}}</td>
              <td class="px-2 py-1.5 text-xs whitespace-nowrap" style="color:var(--text-secondary)">{{fmtDate(p['Start-Up Monitor']||p['Completion Date'])||'—'}}</td>
              <td class="px-2 py-1.5 text-[10px]" style="color:var(--text-secondary);min-width:280px">
                <div v-if="getNotesForProject(p['Project ID'])" class="max-h-[200px] overflow-y-auto">
                  <template v-for="(line, li) in getNotesForProject(p['Project ID']).split('\n')" :key="li">
                    <div class="py-1 leading-relaxed">{{ line }}</div>
                    <div v-if="li < getNotesForProject(p['Project ID']).split('\n').length - 1" style="border-bottom:1px solid var(--border-subtle);margin:2px 0"/>
                  </template>
                </div>
                <span v-else style="color:var(--text-tertiary)">—</span>
              </td>
            </tr>
            <!-- Load more row -->
            <tr v-if="loadingMore">
              <td colspan="9" class="text-center py-4">
                <Icon name="i-lucide-loader-2" class="w-5 h-5 animate-spin mx-auto" style="color:var(--drive-green)"/>
              </td>
            </tr>
            <tr v-if="hasMore && !loadingMore && filtered.length > 0">
              <td colspan="9" class="text-center py-3">
                <span class="text-[11px]" style="color:var(--text-tertiary)">Showing {{filtered.length}} of {{totalCount.toLocaleString()}} — scroll for more</span>
              </td>
            </tr>
            <tr v-if="filtered.length===0 && !loading">
              <td colspan="9" class="text-center py-16" style="color:var(--text-tertiary)">
                <Icon name="i-lucide-inbox" class="w-10 h-10 mx-auto mb-2"/>
                <p>No projects match your filters</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ══ SAVE REPORT MODAL ══════════════════════════════════════════════ -->
    <div v-if="showSaveModal" class="fixed inset-0 z-[55] flex items-center justify-center" style="background:rgba(0,0,0,0.6)" @click.self="showSaveModal=false">
      <div class="rounded-2xl shadow-2xl w-[480px] flex flex-col overflow-hidden" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
        <div class="px-6 py-5" style="background:linear-gradient(135deg,rgba(29,164,98,0.12),rgba(15,123,63,0.06));border-bottom:1px solid var(--border-subtle)">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style="background:linear-gradient(135deg,#1da462,#0f7b3f)">🔖</div>
              <div>
                <h2 class="text-sm font-bold">Save Report Template</h2>
                <p class="text-[11px]" style="color:var(--text-tertiary)">Save your current filters for quick access</p>
              </div>
            </div>
            <button class="btn-icon" style="width:28px;height:28px" @click="showSaveModal=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
          </div>
        </div>
        <div class="px-6 py-5 space-y-5">
          <div>
            <label class="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style="color:var(--text-tertiary)">Choose an icon</label>
            <div class="flex gap-2 flex-wrap">
              <button v-for="ic in REPORT_ICONS" :key="ic"
                class="w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all"
                :style="{background: saveIcon===ic ? 'linear-gradient(135deg,#1da462,#0f7b3f)' : 'var(--surface-elevated)', border: saveIcon===ic ? '2px solid #1da462' : '2px solid transparent', transform: saveIcon===ic ? 'scale(1.15)' : 'scale(1)'}"
                @click="saveIcon=ic">{{ic}}</button>
            </div>
          </div>
          <div>
            <label class="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style="color:var(--text-tertiary)">Report name</label>
            <div class="flex items-center gap-2 px-3 py-2.5 rounded-xl" style="background:var(--surface-elevated);border:1.5px solid var(--border-subtle)">
              <span class="text-lg">{{saveIcon}}</span>
              <input v-model="saveName" class="flex-1 bg-transparent outline-none text-sm font-medium" placeholder="e.g. Q2 Active Projects · Branch LA" @keyup.enter="doSaveReport" autofocus>
            </div>
          </div>
          <div v-if="getFilterLabels(getCurrentFilters()).length">
            <label class="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style="color:var(--text-tertiary)">Active filters being saved</label>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="lbl in getFilterLabels(getCurrentFilters())" :key="lbl" class="px-2 py-0.5 rounded-full text-[10px] font-medium" style="background:color-mix(in srgb,var(--drive-green) 12%,transparent);color:var(--drive-green);border:1px solid color-mix(in srgb,var(--drive-green) 30%,transparent)">{{lbl}}</span>
            </div>
          </div>
          <div v-else class="text-[11px] py-2 rounded-lg px-3" style="background:var(--surface-elevated);color:var(--text-tertiary)">⚠️ No active filters — all projects will be shown when this template is applied.</div>
        </div>
        <div class="px-6 py-4 flex justify-end gap-2" style="border-top:1px solid var(--border-subtle)">
          <button class="btn-icon px-4" style="height:36px;font-size:12px" @click="showSaveModal=false">Cancel</button>
          <button class="btn-primary" :disabled="!saveName.trim()" @click="doSaveReport" style="height:36px;padding:0 20px;font-size:12px">
            <Icon name="i-lucide-bookmark-check" class="w-3.5 h-3.5"/>Save Template
          </button>
        </div>
      </div>
    </div>

    <!-- ══ LOAD REPORTS MODAL ═════════════════════════════════════════════ -->
    <div v-if="showLoadModal" class="fixed inset-0 z-[55] flex items-end sm:items-center justify-center" style="background:rgba(0,0,0,0.6)" @click.self="showLoadModal=false;deleteConfirmId=null;editingReportId=null">
      <div class="rounded-2xl shadow-2xl w-full sm:w-[640px] max-h-[85vh] flex flex-col" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
        <div class="px-6 py-5 flex items-center justify-between shrink-0" style="background:linear-gradient(135deg,rgba(139,92,246,0.1),rgba(109,40,217,0.05));border-bottom:1px solid var(--border-subtle)">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9)">🗂️</div>
            <div>
              <h2 class="text-sm font-bold">Saved Report Templates</h2>
              <p class="text-[11px]" style="color:var(--text-tertiary)">{{savedReports.length}} template{{savedReports.length===1?'':'s'}} saved for {{session.name || 'you'}}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn-primary" style="background:linear-gradient(135deg,#1da462,#0f7b3f);height:32px;font-size:12px" @click="showLoadModal=false;openSaveModal()">
              <Icon name="i-lucide-bookmark-plus" class="w-3.5 h-3.5"/>Save Current
            </button>
            <button class="btn-icon" style="width:28px;height:28px" @click="showLoadModal=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
          </div>
        </div>
        <div class="px-5 py-3 shrink-0" style="border-bottom:1px solid var(--border-subtle)">
          <div class="relative">
            <Icon name="i-lucide-search" class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style="color:var(--text-tertiary)"/>
            <input v-model="savedReportSearch" class="input-base w-full" style="height:34px;font-size:12px;padding-left:32px" placeholder="Search saved reports...">
          </div>
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <div v-if="savedReports.length === 0" class="flex flex-col items-center justify-center py-16 gap-3">
            <div class="text-5xl">📭</div>
            <p class="text-sm font-semibold" style="color:var(--text-secondary)">No saved reports yet</p>
            <p class="text-[11px]" style="color:var(--text-tertiary)">Set your filters and click "Save" to create your first template</p>
            <button class="btn-primary mt-2" @click="showLoadModal=false;openSaveModal()"><Icon name="i-lucide-bookmark-plus" class="w-3.5 h-3.5"/>Save Current Filters</button>
          </div>
          <div v-else-if="filteredSavedReports.length === 0" class="text-center py-10 text-[12px]" style="color:var(--text-tertiary)">No templates match "{{savedReportSearch}}"</div>
          <div v-for="report in filteredSavedReports" :key="report.id"
            class="rounded-xl p-4 transition-all group"
            :style="{background: activeReportId===report.id ? 'color-mix(in srgb,var(--drive-green) 8%,var(--surface-elevated))' : 'var(--surface-elevated)', border: activeReportId===report.id ? '1.5px solid var(--drive-green)' : '1.5px solid var(--border-subtle)'}">
            <div class="flex items-start gap-3">
              <div class="relative shrink-0">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style="background:var(--surface-card)">{{report.icon}}</div>
                <div v-if="activeReportId===report.id" class="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center" style="background:var(--drive-green)">
                  <Icon name="i-lucide-check" class="w-2.5 h-2.5 text-white"/>
                </div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <template v-if="editingReportId===report.id">
                    <input v-model="editingName" class="input-base flex-1" style="height:28px;font-size:13px;font-weight:700" @keyup.enter="confirmEditName(report)" @keyup.escape="editingReportId=null" autofocus>
                    <button class="btn-icon" style="width:26px;height:26px" @click="confirmEditName(report)"><Icon name="i-lucide-check" class="w-3.5 h-3.5" style="color:var(--drive-green)"/></button>
                    <button class="btn-icon" style="width:26px;height:26px" @click="editingReportId=null"><Icon name="i-lucide-x" class="w-3 h-3"/></button>
                  </template>
                  <template v-else>
                    <span class="text-sm font-bold truncate">{{report.name}}</span>
                    <button class="btn-icon opacity-0 group-hover:opacity-100 transition-opacity" style="width:22px;height:22px" @click.stop="startEditName(report)"><Icon name="i-lucide-pencil" class="w-3 h-3"/></button>
                  </template>
                </div>
                <div class="flex flex-wrap gap-1 mb-2">
                  <span v-for="lbl in getFilterLabels(report.filters).slice(0,5)" :key="lbl" class="px-1.5 py-0.5 rounded text-[9px] font-medium" style="background:color-mix(in srgb,#8b5cf6 12%,transparent);color:#a78bfa;border:1px solid color-mix(in srgb,#8b5cf6 25%,transparent)">{{lbl}}</span>
                  <span v-if="getFilterLabels(report.filters).length > 5" class="px-1.5 py-0.5 rounded text-[9px] font-medium" style="background:var(--surface-card);color:var(--text-tertiary)">+{{getFilterLabels(report.filters).length - 5}} more</span>
                  <span v-if="!getFilterLabels(report.filters).length" class="text-[9px]" style="color:var(--text-tertiary)">No filters (all projects)</span>
                </div>
                <div class="text-[10px]" style="color:var(--text-tertiary)">Saved {{new Date(report.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}}</div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <template v-if="deleteConfirmId===report.id">
                  <span class="text-[10px] mr-1" style="color:#ef4444">Delete?</span>
                  <button class="btn-icon" style="width:26px;height:26px;background:#ef4444" @click="doDeleteReport(report.id)"><Icon name="i-lucide-check" class="w-3 h-3 text-white"/></button>
                  <button class="btn-icon" style="width:26px;height:26px" @click="deleteConfirmId=null"><Icon name="i-lucide-x" class="w-3 h-3"/></button>
                </template>
                <template v-else>
                  <button class="btn-icon" style="width:26px;height:26px" @click="deleteConfirmId=report.id"><Icon name="i-lucide-trash-2" class="w-3.5 h-3.5" style="color:#ef4444"/></button>
                  <button class="px-3 py-1.5 rounded-lg text-[11px] font-semibold" :style="activeReportId===report.id ? 'background:var(--drive-green);color:#fff' : 'background:linear-gradient(135deg,#1da462,#0f7b3f);color:#fff'" @click="applyReport(report)">
                    {{activeReportId===report.id ? '✓ Active' : 'Apply'}}
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
