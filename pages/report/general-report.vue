<script setup lang="ts">
useHead({ title: 'General Report' })

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
const vendorMap = ref<Record<string, string>>({})
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

const dateOfOptions = ['SSA','Solar Install','MPU Install','Battery Install','Completion','Final','Start-up / Monitor','Contract Sign']

// Name resolution: email → display name, or sales rep ID → name
function resolveName(val: string): string {
  if (!val) return ''
  return userNameMap.value[val.toLowerCase()] || val
}
function resolveSalesRep(id: string): string {
  if (!id) return ''
  return salesRepMap.value[id] || id
}
function resolveVendor(id: string): string {
  if (!id) return ''
  return vendorMap.value[id] || id
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
    const [s, opts, usersData, salesRepsData, vendorsData] = await Promise.all([
      $fetch<any>('/api/auth/session'),
      $fetch<any>('/api/bq/filter-options'),
      $fetch<any>('/api/bq/users'),
      $fetch<any>('/api/bq/sales-reps'),
      $fetch<any>('/api/bq/vendors'),
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

    // Build vendor map (Row ID → Vendor Name)
    const vendorsList: any[] = vendorsData.vendors || []
    const vMap: Record<string, string> = {}
    for (const v of vendorsList) {
      const id = v['Row ID'] || ''
      if (id) {
        vMap[id] = v['Vendor Name'] || id
      }
    }
    vendorMap.value = vMap

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
      $fetch<any>('/api/bq/general-projects', { params }),
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
    const r = await $fetch<any>('/api/bq/general-projects', { params })
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
    [p['Customer Address'], p['Job Status'], p['Project Status'], p['Sales Rep'], p['Branch Name'], p['Project Type'], p['Vendor'], p['Project Manager'], p['Finance Manager'], p['AHJ']].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
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

// Column definitions for table rendering
const columns = [
  { key: 'Customer Address', label: 'Project Address', minW: '200px' },
  { key: 'Project Type', label: 'Project Type' },
  { key: 'Job Status', label: 'Job Status', chip: 'job' as const },
  { key: 'Project Status', label: 'Project Status', chip: 'project' as const },
  { key: 'Project Equipment', label: 'Project Equipment' },
  { key: 'Contract sign Date', label: 'Contract Sign', date: true },
  { key: 'SSA', label: 'SSA', date: true },
  { key: 'SSA Status', label: 'SSA Status' },
  { key: 'Solar Install', label: 'Solar Install', date: true },
  { key: 'Solar Install Status', label: 'Solar Install Status' },
  { key: 'MPU Installed', label: 'MPU Installed', date: true },
  { key: 'MPU Installed Status', label: 'MPU Install Status' },
  { key: 'Battery Installed', label: 'Battery Installed', date: true },
  { key: 'Battery Installed Status', label: 'Battery Install Status' },
  { key: 'Completion Date', label: 'Completion', date: true },
  { key: 'Completion Status', label: 'Completion Status' },
  { key: 'Final Date', label: 'Final', date: true },
  { key: 'Final Status', label: 'Final Status' },
  { key: 'Start-Up Monitor', label: 'Startup Monitor', date: true },
  { key: 'Start-Up Monitor Status', label: 'Startup Monitor Status' },
  { key: 'Branch Name', label: 'Branch Name' },
  { key: 'Vendor', label: 'Vendor', resolve: 'vendor' as const },
  { key: 'Sales Rep', label: 'Sales Rep', resolve: 'salesRep' as const },
  { key: 'Permit Coordinator', label: 'Permit Tech', resolve: 'email' as const },
  { key: 'Engineer', label: 'Engineer', resolve: 'email' as const },
  { key: 'Utillity', label: 'Utility' },
  { key: 'Panels Amount', label: 'Pannels Amount' },
  { key: 'Watt', label: 'Watt' },
  { key: 'KW', label: 'KW' },
  { key: 'Solar Equipment', label: 'Solar Equipment' },
  { key: 'Project Manager', label: 'Project Manager', resolve: 'email' as const },
  { key: 'Secondary Project Manager', label: 'Secondary Project Manager', resolve: 'email' as const },
  { key: 'Project Price', label: 'Project Price' },
  { key: 'Project Manager VA', label: 'Project Manager VA', resolve: 'email' as const },
  { key: 'Secondary Project Manager VA', label: 'Secondary PM VA', resolve: 'email' as const },
  { key: 'Finance Manager', label: 'Finance Manager', resolve: 'email' as const },
  { key: 'Secondary Finance Manager', label: 'Secondary Finance Manager', resolve: 'email' as const },
  { key: 'Finance Manager VA', label: 'Finance Manager VA', resolve: 'email' as const },
  { key: 'Finance Companies', label: 'Finance Companies' },
  { key: 'Project End', label: 'Project Close' },
  { key: 'Finance Ready', label: 'Finance Ready' },
  { key: 'PM Approve Project', label: 'PM Approve Project' },
  { key: 'Cold Water Re-Location Ft', label: 'Cold Water Re-Location' },
  { key: 'EV Charger ft', label: 'EV Charger ft' },
  { key: 'Trenching ft', label: 'Trenching ft' },
  { key: 'Solar Removal Amount', label: 'Solar Removal Amount' },
  { key: 'MPU Location', label: 'MPU Location' },
  { key: 'MPU Distance ft', label: 'MPU Distance ft' },
  { key: 'Trenching type', label: 'Trenching Type' },
  { key: 'Sub-Panel Amp', label: 'Sub-Panel Amp' },
  { key: 'Drate Amp', label: 'Derate Amp' },
  { key: 'Fire Approval Needed', label: 'Fire Approval Needed' },
  { key: 'Inverter Type', label: 'Inverter Type' },
  { key: 'Batteries Qty', label: 'Batteries Qty' },
  { key: 'Sub-Panel Qty', label: 'Sub Panel Qty' },
  { key: 'Jurisdiction Phone Number', label: 'ESR Phone' },
  { key: 'Fire Department Email', label: 'Fire Department Email' },
  { key: 'Fire Department Phone', label: 'Fire Department Phone' },
  { key: 'Fire Department Inspector Email', label: 'Fire Dept Inspector Email' },
  { key: 'Fire Department Inspector Phone', label: 'Fire Dept Inspector Phone' },
  { key: 'Fire Inspection', label: 'Fire Inspection' },
  { key: 'Existing System', label: 'Existing System' },
  { key: 'Trench Fill Date', label: 'Trench Fill' },
  { key: 'Stucco', label: 'Stucco Status' },
  { key: 'Trench Fill Date', label: 'Trench Fill Status' },
  { key: 'Combiner Box', label: 'Combiner Box' },
  { key: 'Service', label: 'Service' },
  { key: 'WR#', label: 'WR#' },
  { key: 'SR#', label: 'SR#' },
  { key: 'SBP#', label: 'SBP#' },
  { key: 'AHJ', label: 'AHJ' },
  { key: 'Last Activity Date', label: 'Last Activity Date', date: true },
  { key: 'ntp', label: 'NTP' },
  { key: '__notes__', label: 'Project Notes', isNotes: true },
]

const COL_COUNT = columns.length

function cellValue(p: any, col: typeof columns[0]): string {
  if ((col as any).isNotes) return getNotesForProject(p['Project ID'] || '')
  let raw = p[col.key]
  if (raw == null || raw === '') return '—'
  if (typeof raw === 'object' && raw !== null && 'value' in raw) raw = raw.value
  if (raw == null || raw === '') return '—'
  if (col.date) return fmtDate(raw) || '—'
  if (col.resolve === 'email') return resolveName(String(raw))
  if (col.resolve === 'salesRep') return resolveSalesRep(String(raw))
  if (col.resolve === 'vendor') return resolveVendor(String(raw))
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) { const d = fmtDate(raw); if (d) return d }
  return String(raw)
}

// ── Column Chooser ──────────────────────────────────────────────────────────
const LS_KEY = 'gr_selected_cols_v1'
const MAX_COLS = 15
const showColChooser = ref(false)
const pendingCols = ref<string[]>([])

function loadSavedCols(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as string[]
      const valid = arr.filter(k => columns.some(c => c.key === k)).slice(0, MAX_COLS)
      if (valid.length) return valid
    }
  } catch {}
  // Default: first 15 columns
  return columns.slice(0, MAX_COLS).map(c => c.key)
}

const selectedColKeys = ref<string[]>(loadSavedCols())

const selectedColumns = computed(() =>
  selectedColKeys.value.map(k => columns.find(c => c.key === k)).filter(Boolean) as typeof columns
)

function openColChooser() {
  pendingCols.value = [...selectedColKeys.value]
  showColChooser.value = true
}

function togglePendingCol(key: string) {
  const idx = pendingCols.value.indexOf(key)
  if (idx >= 0) {
    pendingCols.value = pendingCols.value.filter(k => k !== key)
  } else {
    if (pendingCols.value.length >= MAX_COLS) return
    pendingCols.value = [...pendingCols.value, key]
  }
}

function applyColsAndDownloadCSV() {
  selectedColKeys.value = [...pendingCols.value]
  localStorage.setItem(LS_KEY, JSON.stringify(selectedColKeys.value))
  showColChooser.value = false
  doDownloadCSV()
}

function doDownloadCSV() {
  const cols = selectedColumns.value
  const rows = filtered.value
  const headers = cols.map(c => c.label)
  const csvRows = [headers.join(',')]
  for (const p of rows) {
    const vals = cols.map(c => {
      let v = cellValue(p, c)
      if (v === '—') v = ''
      return `"${v.replace(/"/g, '""')}"`
    })
    csvRows.push(vals.join(','))
  }
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `general-report-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── PDF Preview ──────────────────────────────────────────────────────────────
const showPdfPreview = ref(false)
const pdfPreviewHtml = ref('')
const pendingPdfCols = ref<string[]>([])
const showPdfColChooser = ref(false)

function openPdfColChooser() {
  pendingPdfCols.value = [...selectedColKeys.value]
  showPdfColChooser.value = true
}

function togglePendingPdfCol(key: string) {
  const idx = pendingPdfCols.value.indexOf(key)
  if (idx >= 0) {
    pendingPdfCols.value = pendingPdfCols.value.filter(k => k !== key)
  } else {
    if (pendingPdfCols.value.length >= MAX_COLS) return
    pendingPdfCols.value = [...pendingPdfCols.value, key]
  }
}

function applyPdfColsAndPreview() {
  selectedColKeys.value = [...pendingPdfCols.value]
  localStorage.setItem(LS_KEY, JSON.stringify(selectedColKeys.value))
  showPdfColChooser.value = false
  buildPdfPreview()
}

function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function buildPdfPreview() {
  const cols = selectedColumns.value
  const rows = filtered.value
  const today = new Date()
  const reportDate = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}-${today.getFullYear()}`
  const ths = cols.map(c => `<th>${esc(c.label)}</th>`).join('')
  const trs = rows.map((p: any) => {
    const tds = cols.map(c => {
      if ((c as any).isNotes) {
        const n = getNotesForProject(p['Project ID'] || '')
        return `<td class="notes-cell">${n ? `<div class="nc">${esc(n).replace(/\n/g,'<br>')}</div>` : ''}</td>`
      }
      return `<td>${esc(cellValue(p, c))}</td>`
    }).join('')
    return `<tr>${tds}</tr>`
  }).join('')
  pdfPreviewHtml.value = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>General Report</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;padding:30px 40px;color:#111;font-size:11px}h1{font-size:18px;font-weight:700;margin-bottom:4px}.rd{font-size:11px;margin-bottom:16px}table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#f4f6f8;font-weight:600;font-size:10px;text-align:left;padding:6px 8px;border:1px solid #d0d5dd;white-space:nowrap}td{padding:5px 8px;border:1px solid #d0d5dd;font-size:10px;vertical-align:top}tr:nth-child(even){background:#fafbfc}.notes-cell{max-width:220px}.nc{font-size:9px;line-height:1.4;color:#333;white-space:pre-line}@media print{body{padding:20px}@page{size:landscape;margin:12mm}}</style></head><body><h1>General Report${session.value.name ? ' — ' + esc(session.value.name) : ''}</h1><p class="rd">Report Date: ${reportDate} &bull; Total: ${rows.length} projects</p><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></body></html>`
  showPdfPreview.value = true
}

function printPdf() {
  const w = window.open('', '_blank')
  if (w) { w.document.write(pdfPreviewHtml.value); w.document.close(); setTimeout(() => w.print(), 400) }
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
          <h1 class="text-sm font-bold">General Report <span v-if="session.name" style="color:var(--text-secondary)">— {{session.name}}</span></h1>
          <p class="text-[11px]" style="color:var(--text-tertiary)">Report Date: {{new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium" style="color:var(--text-tertiary)">{{totalCount.toLocaleString()}} projects</span>
        <button class="btn-primary" @click="openColChooser"><Icon name="i-lucide-download" class="w-3.5 h-3.5"/>Download CSV</button>
        <button class="btn-primary" style="background:linear-gradient(135deg,#2563eb,#1d4ed8)" @click="openPdfColChooser"><Icon name="i-lucide-file-text" class="w-3.5 h-3.5"/>Preview / PDF</button>
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
              <th v-for="col in selectedColumns" :key="col.key" class="text-left text-[11px] font-semibold px-2 py-2 whitespace-nowrap" :style="{borderBottom:'1px solid var(--border-subtle)',color:'var(--text-secondary)',minWidth: (col as any).isNotes ? '260px' : col.minW || 'auto'}">{{col.label}}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in filtered" :key="p['Project ID']||i" class="transition-colors" style="border-bottom:1px solid var(--border-subtle)" :style="{'background': i%2===0 ? 'transparent' : 'var(--surface-card)'}">
              <td v-for="col in selectedColumns" :key="col.key" class="px-2 py-1.5 text-xs" :class="(col as any).isNotes ? '' : 'whitespace-nowrap'" :style="{color: cellValue(p, col) === '—' ? 'var(--text-tertiary)' : col.chip ? undefined : 'var(--text-secondary)', minWidth: (col as any).isNotes ? '260px' : col.minW || 'auto'}">
                <span v-if="col.chip && p[col.key]" class="status-chip" :class="chipClass(p[col.key], col.chip)">{{p[col.key]}}</span>
                <template v-else-if="(col as any).isNotes">
                  <div v-if="getNotesForProject(p['Project ID'])" class="max-h-[160px] overflow-y-auto text-[10px]">
                    <template v-for="(line, li) in getNotesForProject(p['Project ID']).split('\n')" :key="li">
                      <div class="py-0.5 leading-relaxed">{{ line }}</div>
                      <div v-if="li < getNotesForProject(p['Project ID']).split('\n').length - 1" style="border-bottom:1px solid var(--border-subtle);margin:1px 0"/>
                    </template>
                  </div>
                  <span v-else style="color:var(--text-tertiary)">—</span>
                </template>
                <span v-else>{{cellValue(p, col)}}</span>
              </td>
            </tr>
            <!-- Load more row -->
            <tr v-if="loadingMore">
              <td :colspan="selectedColumns.length" class="text-center py-4">
                <Icon name="i-lucide-loader-2" class="w-5 h-5 animate-spin mx-auto" style="color:var(--drive-green)"/>
              </td>
            </tr>
            <tr v-if="hasMore && !loadingMore && filtered.length > 0">
              <td :colspan="selectedColumns.length" class="text-center py-3">
                <span class="text-[11px]" style="color:var(--text-tertiary)">Showing {{filtered.length}} of {{totalCount.toLocaleString()}} — scroll for more</span>
              </td>
            </tr>
            <tr v-if="filtered.length===0 && !loading">
              <td :colspan="selectedColumns.length" class="text-center py-16" style="color:var(--text-tertiary)">
                <Icon name="i-lucide-inbox" class="w-10 h-10 mx-auto mb-2"/>
                <p>No projects match your filters</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Column Chooser Modal (CSV) ─────────────────────────────────── -->
    <div v-if="showColChooser" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.55)" @click.self="showColChooser=false">
      <div class="rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
        <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--border-subtle)">
          <div>
            <h2 class="text-sm font-bold">Choose Columns to Download</h2>
            <p class="text-[11px]" style="color:var(--text-tertiary)">Select up to {{MAX_COLS}} columns. Your selection will be saved.</p>
          </div>
          <button class="btn-icon" style="width:28px;height:28px" @click="showColChooser=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
        </div>
        <div class="px-4 py-3 flex-1 overflow-y-auto">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-[11px] font-semibold" style="color:var(--text-secondary)">{{pendingCols.length}} / {{MAX_COLS}} selected</span>
            <button class="text-[11px]" style="color:var(--drive-green)" @click="pendingCols = columns.slice(0,MAX_COLS).map(c=>c.key)">Reset to default</button>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="col in columns" :key="col.key"
              class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors"
              :style="{background: pendingCols.includes(col.key) ? 'color-mix(in srgb,var(--drive-green) 15%,transparent)' : 'var(--surface-elevated)', border: pendingCols.includes(col.key) ? '1px solid var(--drive-green)' : '1px solid var(--border-subtle)', opacity: (!pendingCols.includes(col.key) && pendingCols.length >= MAX_COLS) ? '0.45' : '1', cursor: (!pendingCols.includes(col.key) && pendingCols.length >= MAX_COLS) ? 'not-allowed' : 'pointer'}"
              @click="togglePendingCol(col.key)"
            >
              <Icon :name="pendingCols.includes(col.key) ? 'i-lucide-check-square' : 'i-lucide-square'" class="w-3.5 h-3.5 shrink-0" :style="{color: pendingCols.includes(col.key) ? 'var(--drive-green)' : 'var(--text-tertiary)'}"/>
              <span class="truncate">{{col.label}}</span>
            </button>
          </div>
        </div>
        <div class="px-5 py-3 flex justify-end gap-2" style="border-top:1px solid var(--border-subtle)">
          <button class="btn-icon px-4" style="height:34px;font-size:12px" @click="showColChooser=false">Cancel</button>
          <button class="btn-primary" :disabled="pendingCols.length === 0" @click="applyColsAndDownloadCSV"><Icon name="i-lucide-download" class="w-3.5 h-3.5"/>Download CSV</button>
        </div>
      </div>
    </div>

    <!-- ── Column Chooser Modal (PDF) ─────────────────────────────────── -->
    <div v-if="showPdfColChooser" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.55)" @click.self="showPdfColChooser=false">
      <div class="rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
        <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--border-subtle)">
          <div>
            <h2 class="text-sm font-bold">Choose Columns for PDF</h2>
            <p class="text-[11px]" style="color:var(--text-tertiary)">Select up to {{MAX_COLS}} columns for your PDF report.</p>
          </div>
          <button class="btn-icon" style="width:28px;height:28px" @click="showPdfColChooser=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
        </div>
        <div class="px-4 py-3 flex-1 overflow-y-auto">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-[11px] font-semibold" style="color:var(--text-secondary)">{{pendingPdfCols.length}} / {{MAX_COLS}} selected</span>
            <button class="text-[11px]" style="color:#2563eb" @click="pendingPdfCols = columns.slice(0,MAX_COLS).map(c=>c.key)">Reset to default</button>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="col in columns" :key="col.key"
              class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors"
              :style="{background: pendingPdfCols.includes(col.key) ? 'color-mix(in srgb,#2563eb 15%,transparent)' : 'var(--surface-elevated)', border: pendingPdfCols.includes(col.key) ? '1px solid #2563eb' : '1px solid var(--border-subtle)', opacity: (!pendingPdfCols.includes(col.key) && pendingPdfCols.length >= MAX_COLS) ? '0.45' : '1', cursor: (!pendingPdfCols.includes(col.key) && pendingPdfCols.length >= MAX_COLS) ? 'not-allowed' : 'pointer'}"
              @click="togglePendingPdfCol(col.key)"
            >
              <Icon :name="pendingPdfCols.includes(col.key) ? 'i-lucide-check-square' : 'i-lucide-square'" class="w-3.5 h-3.5 shrink-0" :style="{color: pendingPdfCols.includes(col.key) ? '#2563eb' : 'var(--text-tertiary)'}"/>
              <span class="truncate">{{col.label}}</span>
            </button>
          </div>
        </div>
        <div class="px-5 py-3 flex justify-end gap-2" style="border-top:1px solid var(--border-subtle)">
          <button class="btn-icon px-4" style="height:34px;font-size:12px" @click="showPdfColChooser=false">Cancel</button>
          <button class="btn-primary" style="background:linear-gradient(135deg,#2563eb,#1d4ed8)" :disabled="pendingPdfCols.length === 0" @click="applyPdfColsAndPreview"><Icon name="i-lucide-eye" class="w-3.5 h-3.5"/>Preview Report</button>
        </div>
      </div>
    </div>

    <!-- ── PDF Preview Modal ──────────────────────────────────────────── -->
    <div v-if="showPdfPreview" class="fixed inset-0 z-50 flex flex-col" style="background:rgba(0,0,0,0.75)">
      <div class="flex items-center justify-between px-5 py-3 shrink-0" style="background:var(--surface-card);border-bottom:1px solid var(--border-subtle)">
        <div class="flex items-center gap-3">
          <Icon name="i-lucide-file-text" class="w-5 h-5" style="color:#2563eb"/>
          <span class="text-sm font-bold">PDF Preview</span>
          <span class="text-[11px]" style="color:var(--text-tertiary)">{{filtered.length}} rows · {{selectedColumns.length}} columns</span>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-primary" style="background:linear-gradient(135deg,#2563eb,#1d4ed8)" @click="printPdf"><Icon name="i-lucide-printer" class="w-3.5 h-3.5"/>Print / Save PDF</button>
          <button class="btn-icon" style="width:32px;height:32px" @click="showPdfPreview=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
        </div>
      </div>
      <iframe class="flex-1 w-full" :srcdoc="pdfPreviewHtml" style="background:#fff"/>
    </div>
  </div>
</template>
