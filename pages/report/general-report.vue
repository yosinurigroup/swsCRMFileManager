<script setup lang="ts">
import { useSavedReports, REPORT_ICONS } from '~/composables/useSavedReports'
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
const branch = ref<string[]>([])
const vendor = ref<string[]>([])
const salesRep = ref<string[]>([])
const projectType = ref<string[]>([])
const jobStatus = ref<string[]>([])
const projectStatus = ref<string[]>([])
const projectManager = ref<string[]>([])
const financeManager = ref<string[]>([])
const engineer = ref<string[]>([])
const permitCoordinator = ref<string[]>([])
const utility = ref<string[]>([])
const solarEquipment = ref<string[]>([])
const ssaStatus = ref<string[]>([])
const solarInstallStatus = ref<string[]>([])
const completionStatus = ref<string[]>([])
const finalStatus = ref<string[]>([])

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
  if (branch.value.length) params.branch = branch.value.join(',')
  if (vendor.value.length) params.vendor = vendor.value.join(',')
  if (salesRep.value.length) params.salesRep = salesRep.value.join(',')
  if (projectType.value.length) params.projectType = projectType.value.join(',')
  if (jobStatus.value.length) params.jobStatus = jobStatus.value.join(',')
  if (projectStatus.value.length) params.projectStatus = projectStatus.value.join(',')
  if (projectManager.value.length) params.projectManager = projectManager.value.join(',')
  if (financeManager.value.length) params.financeManager = financeManager.value.join(',')
  if (engineer.value.length) params.engineer = engineer.value.join(',')
  if (permitCoordinator.value.length) params.permitCoordinator = permitCoordinator.value.join(',')
  if (utility.value.length) params.utility = utility.value.join(',')
  if (solarEquipment.value.length) params.solarEquipment = solarEquipment.value.join(',')
  if (ssaStatus.value.length) params.ssaStatus = ssaStatus.value.join(',')
  if (solarInstallStatus.value.length) params.solarInstallStatus = solarInstallStatus.value.join(',')
  if (completionStatus.value.length) params.completionStatus = completionStatus.value.join(',')
  if (finalStatus.value.length) params.finalStatus = finalStatus.value.join(',')
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
  branch.value = []; vendor.value = []; salesRep.value = []; projectType.value = []
  jobStatus.value = []; projectStatus.value = []
  projectManager.value = []; financeManager.value = []; engineer.value = []
  permitCoordinator.value = []; utility.value = []; solarEquipment.value = []
  ssaStatus.value = []; solarInstallStatus.value = []; completionStatus.value = []; finalStatus.value = []
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
  { key: 'Trench Fill Date', label: 'Trench Fill', date: true },
  { key: 'Stucco', label: 'Stucco Status' },
  { key: 'Trench Fill Status', label: 'Trench Fill Status' },
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
const colSearch = ref('')
const pdfColSearch = ref('')

const filteredChooserCols = computed(() => {
  const q = colSearch.value.toLowerCase().trim()
  return q ? columns.filter(c => c.label.toLowerCase().includes(q)) : columns
})

const filteredPdfChooserCols = computed(() => {
  const q = pdfColSearch.value.toLowerCase().trim()
  return q ? columns.filter(c => c.label.toLowerCase().includes(q)) : columns
})

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
  colSearch.value = ''
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

const downloadLoading = ref(false)

async function fetchAllRows(): Promise<any[]> {
  const allRows: any[] = []
  const params = buildParams()
  let offset = 0
  const BATCH = 500
  while (true) {
    params.limit = String(BATCH)
    params.offset = String(offset)
    const r = await $fetch<any>('/api/bq/general-projects', { params })
    const batch = r.projects || []
    allRows.push(...batch)
    if (allRows.length >= (r.total || 0) || batch.length < BATCH) break
    offset += BATCH
  }
  // Also fetch notes for all loaded IDs not yet cached
  const newIds = allRows.map((p: any) => p['Project ID']).filter((id: string) => id && !notesMapCache.value[id])
  if (newIds.length) {
    try {
      const nr = await $fetch<any>('/api/bq/notes', { params: { projectIds: newIds.join(',') } })
      notes.value = [...notes.value, ...(nr.notes || [])]
    } catch {}
  }
  return allRows
}

function applyColsAndDownloadCSV() {
  selectedColKeys.value = [...pendingCols.value]
  localStorage.setItem(LS_KEY, JSON.stringify(selectedColKeys.value))
  showColChooser.value = false
  doDownloadCSV()
}

async function doDownloadCSV() {
  downloadLoading.value = true
  try {
    const cols = selectedColumns.value
    const rows = await fetchAllRows()
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
  } catch (e) { console.error(e) } finally { downloadLoading.value = false }
}

// ── PDF Preview ──────────────────────────────────────────────────────────────
const showPdfPreview = ref(false)
const pdfPreviewHtml = ref('')
const pendingPdfCols = ref<string[]>([])
const showPdfColChooser = ref(false)

function openPdfColChooser() {
  pendingPdfCols.value = [...selectedColKeys.value]
  pdfColSearch.value = ''
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

async function buildPdfPreview() {
  downloadLoading.value = true
  try {
    const cols = selectedColumns.value
    const rows = await fetchAllRows()
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
  } catch (e) { console.error(e) } finally { downloadLoading.value = false }
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
  if (!value) {
    // "All" clicked — clear the array
    filterModels[model].value = []
    return
  }
  const arr: string[] = filterModels[model].value
  const idx = arr.indexOf(value)
  if (idx >= 0) {
    filterModels[model].value = arr.filter((v: string) => v !== value)
  } else {
    filterModels[model].value = [...arr, value]
  }
  // Keep dropdown open for multi-select
}

function getFilteredItems(f: typeof filterDefs[0]): {value: string, label: string}[] {
  const items = dropdownItems(f.key)
  const q = (dropdownSearches.value[f.model] || '').toLowerCase()
  if (!q) return items
  return items.filter(i => i.label.toLowerCase().includes(q))
}

function getSelectedLabel(f: typeof filterDefs[0]): string {
  const arr: string[] = filterModels[f.model].value
  if (!arr.length) return 'All'
  if (arr.length === 1) {
    const items = dropdownItems(f.key)
    const found = items.find(i => i.value === arr[0])
    return found ? found.label : (arr[0] ?? '')
  }
  return `${arr.length} selected`
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
const { list: _srList, listSync: _srListSync, save: _srSave, remove: _srRemove, update: _srUpdate } = useSavedReports('general')
const savedReports = ref<any[]>([])
const showSaveModal = ref(false)
const showLoadModal = ref(false)
const saveName = ref('')
const saveIcon = ref('📊')
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
    branch: [...branch.value], vendor: [...vendor.value], salesRep: [...salesRep.value],
    projectType: [...projectType.value], jobStatus: [...jobStatus.value], projectStatus: [...projectStatus.value],
    projectManager: [...projectManager.value], financeManager: [...financeManager.value],
    engineer: [...engineer.value], permitCoordinator: [...permitCoordinator.value],
    utility: [...utility.value], solarEquipment: [...solarEquipment.value],
    ssaStatus: [...ssaStatus.value], solarInstallStatus: [...solarInstallStatus.value],
    completionStatus: [...completionStatus.value], finalStatus: [...finalStatus.value],
    search: search.value,
  }
}

function _hasVal(v: any): boolean {
  if (Array.isArray(v)) return v.length > 0
  return !!v
}
function _fmtVal(v: any): string {
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}
function getFilterLabels(filters: any): string[] {
  const out: string[] = []
  if (filters.dateFrom && filters.dateTo) out.push(`${filters.dateOf}: ${filters.dateFrom} → ${filters.dateTo}`)
  if (_hasVal(filters.branch)) out.push(`Branch: ${_fmtVal(filters.branch)}`)
  if (_hasVal(filters.salesRep)) out.push(`Sales Rep (${Array.isArray(filters.salesRep) ? filters.salesRep.length : 1})`)
  if (_hasVal(filters.vendor)) out.push(`Vendor (${Array.isArray(filters.vendor) ? filters.vendor.length : 1})`)
  if (_hasVal(filters.jobStatus)) out.push(`Job: ${_fmtVal(filters.jobStatus)}`)
  if (_hasVal(filters.projectStatus)) out.push(`Status: ${_fmtVal(filters.projectStatus)}`)
  if (_hasVal(filters.projectType)) out.push(`Type: ${_fmtVal(filters.projectType)}`)
  if (_hasVal(filters.projectManager)) out.push(`PM (${Array.isArray(filters.projectManager) ? filters.projectManager.length : 1})`)
  if (_hasVal(filters.financeManager)) out.push(`FM (${Array.isArray(filters.financeManager) ? filters.financeManager.length : 1})`)
  if (_hasVal(filters.engineer)) out.push(`Engineer (${Array.isArray(filters.engineer) ? filters.engineer.length : 1})`)
  if (_hasVal(filters.permitCoordinator)) out.push(`Permit (${Array.isArray(filters.permitCoordinator) ? filters.permitCoordinator.length : 1})`)
  if (_hasVal(filters.utility)) out.push(`Utility: ${_fmtVal(filters.utility)}`)
  if (_hasVal(filters.solarEquipment)) out.push(`Solar Equip (${Array.isArray(filters.solarEquipment) ? filters.solarEquipment.length : 1})`)
  if (_hasVal(filters.ssaStatus)) out.push(`SSA: ${_fmtVal(filters.ssaStatus)}`)
  if (_hasVal(filters.solarInstallStatus)) out.push(`Solar: ${_fmtVal(filters.solarInstallStatus)}`)
  if (_hasVal(filters.completionStatus)) out.push(`Completion: ${_fmtVal(filters.completionStatus)}`)
  if (_hasVal(filters.finalStatus)) out.push(`Final: ${_fmtVal(filters.finalStatus)}`)
  if (filters.search) out.push(`"${filters.search}"`)
  return out
}

function openSaveModal() {
  saveName.value = ''
  saveIcon.value = '📊'
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
    selectedColKeys: [...selectedColKeys.value],
  }
  await _srSave(tmpl, srUser())
  activeReportId.value = tmpl.id
  showSaveModal.value = false
  await refreshSavedReports()
}

function _toArr(v: any): string[] {
  if (Array.isArray(v)) return [...v]
  if (typeof v === 'string' && v) return [v]
  return []
}
function applyReport(report: any) {
  const f = report.filters || {}
  dateOf.value = f.dateOf || 'SSA'
  dateFrom.value = f.dateFrom || ''
  dateTo.value = f.dateTo || ''
  branch.value = _toArr(f.branch)
  vendor.value = _toArr(f.vendor)
  salesRep.value = _toArr(f.salesRep)
  projectType.value = _toArr(f.projectType)
  jobStatus.value = _toArr(f.jobStatus)
  projectStatus.value = _toArr(f.projectStatus)
  projectManager.value = _toArr(f.projectManager)
  financeManager.value = _toArr(f.financeManager)
  engineer.value = _toArr(f.engineer)
  permitCoordinator.value = _toArr(f.permitCoordinator)
  utility.value = _toArr(f.utility)
  solarEquipment.value = _toArr(f.solarEquipment)
  ssaStatus.value = _toArr(f.ssaStatus)
  solarInstallStatus.value = _toArr(f.solarInstallStatus)
  completionStatus.value = _toArr(f.completionStatus)
  finalStatus.value = _toArr(f.finalStatus)
  search.value = f.search || ''
  if (report.selectedColKeys?.length) {
    selectedColKeys.value = report.selectedColKeys
    localStorage.setItem(LS_KEY, JSON.stringify(selectedColKeys.value))
  }
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

// True when at least one non-default filter or search is active
const hasActiveFilters = computed(() => {
  return !!(dateFrom.value || dateTo.value || branch.value.length || vendor.value.length ||
    salesRep.value.length || projectType.value.length || jobStatus.value.length || projectStatus.value.length ||
    projectManager.value.length || financeManager.value.length || engineer.value.length ||
    permitCoordinator.value.length || utility.value.length || solarEquipment.value.length ||
    ssaStatus.value.length || solarInstallStatus.value.length || completionStatus.value.length ||
    finalStatus.value.length || search.value)
})

// True when the exact current filter combination already exists as a saved report
const isCurrentFilterSaved = computed(() => {
  if (!hasActiveFilters.value) return false
  const cur = JSON.stringify(getCurrentFilters())
  return savedReports.value.some((r: any) => JSON.stringify(r.filters) === cur)
})

// Show Save button only when filters are active AND not already saved
const showSaveButton = computed(() => hasActiveFilters.value && !isCurrentFilterSaved.value)
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

          <!-- ── Reports strip ──────────────────────────────────────── -->
          <div class="flex gap-2">
            <!-- Reports button -->
            <button
              class="flex-1 flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold transition-all relative"
              style="height:30px;background:color-mix(in srgb,#8b5cf6 12%,var(--surface-elevated));border:1px solid color-mix(in srgb,#8b5cf6 30%,transparent);color:#a78bfa"
              @click="showLoadModal=true;savedReportSearch=''">
              <Icon name="i-lucide-folder-open" class="w-3.5 h-3.5"/>
              <span>Reports</span>
              <span v-if="savedReports.length" class="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style="background:#8b5cf6">{{savedReports.length}}</span>
            </button>
            <!-- Save Current Report — only when filters are active AND not already saved -->
            <Transition name="sr-fade">
              <button v-if="showSaveButton"
                class="flex-1 flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold transition-all"
                style="height:30px;background:color-mix(in srgb,var(--drive-green) 14%,var(--surface-elevated));border:1px solid color-mix(in srgb,var(--drive-green) 35%,transparent);color:var(--drive-green)"
                @click="openSaveModal">
                <Icon name="i-lucide-bookmark-plus" class="w-3.5 h-3.5"/>
                <span>Save View</span>
              </button>
            </Transition>
          </div>
          <!-- Active template indicator -->
          <div v-if="activeReport" class="flex items-center gap-1.5 px-2 py-1 rounded-lg" style="background:color-mix(in srgb,var(--drive-green) 10%,var(--surface-elevated));border:1px solid color-mix(in srgb,var(--drive-green) 25%,transparent)">
            <span class="text-sm">{{activeReport.icon}}</span>
            <span class="flex-1 text-[11px] font-semibold truncate" style="color:var(--drive-green)">{{activeReport.name}}</span>
            <button class="shrink-0" style="opacity:0.6" @click="activeReportId=null"><Icon name="i-lucide-x" class="w-3 h-3" style="color:var(--drive-green)"/></button>
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
                :class="{'filter-active': filterModels[f.model].value.length}"
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
                  <!-- All option (clears selection) -->
                  <button
                    class="filter-option"
                    :class="{'filter-option-selected': !filterModels[f.model].value.length}"
                    @click="selectItem(f.model, '')"
                  >
                    <Icon :name="!filterModels[f.model].value.length ? 'i-lucide-check-square' : 'i-lucide-square'" class="w-3.5 h-3.5 shrink-0" :style="{color: !filterModels[f.model].value.length ? 'var(--drive-green)' : 'var(--text-tertiary)', opacity: !filterModels[f.model].value.length ? 1 : 0.3}"/>
                    <span>All</span>
                  </button>
                  <button
                    v-for="item in getFilteredItems(f)"
                    :key="item.value"
                    class="filter-option"
                    :class="{'filter-option-selected': filterModels[f.model].value.includes(item.value)}"
                    @click="selectItem(f.model, item.value)"
                  >
                    <Icon :name="filterModels[f.model].value.includes(item.value) ? 'i-lucide-check-square' : 'i-lucide-square'" class="w-3.5 h-3.5 shrink-0" :style="{color: filterModels[f.model].value.includes(item.value) ? 'var(--drive-green)' : 'var(--text-tertiary)', opacity: filterModels[f.model].value.includes(item.value) ? 1 : 0.3}"/>
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
              <th v-for="col in columns" :key="col.key" class="text-left text-[11px] font-semibold px-2 py-2 whitespace-nowrap" :style="{borderBottom:'1px solid var(--border-subtle)',color:'var(--text-secondary)',minWidth: (col as any).isNotes ? '260px' : col.minW || 'auto'}">{{col.label}}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in filtered" :key="p['Project ID']||i" class="transition-colors" style="border-bottom:1px solid var(--border-subtle)" :style="{'background': i%2===0 ? 'transparent' : 'var(--surface-card)'}">
              <td v-for="col in columns" :key="col.key" class="px-2 py-1.5 text-xs" :class="(col as any).isNotes ? '' : 'whitespace-nowrap'" :style="{color: cellValue(p, col) === '—' ? 'var(--text-tertiary)' : col.chip ? undefined : 'var(--text-secondary)', minWidth: (col as any).isNotes ? '260px' : col.minW || 'auto'}">
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
              <td :colspan="columns.length" class="text-center py-4">
                <Icon name="i-lucide-loader-2" class="w-5 h-5 animate-spin mx-auto" style="color:var(--drive-green)"/>
              </td>
            </tr>
            <tr v-if="hasMore && !loadingMore && filtered.length > 0">
              <td :colspan="columns.length" class="text-center py-3">
                <span class="text-[11px]" style="color:var(--text-tertiary)">Showing {{filtered.length}} of {{totalCount.toLocaleString()}} — scroll for more</span>
              </td>
            </tr>
            <tr v-if="filtered.length===0 && !loading">
              <td :colspan="columns.length" class="text-center py-16" style="color:var(--text-tertiary)">
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
        <!-- Header -->
        <div class="px-6 py-5" style="background:linear-gradient(135deg,rgba(29,164,98,0.12),rgba(15,123,63,0.06));border-bottom:1px solid var(--border-subtle)">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style="background:linear-gradient(135deg,#1da462,#0f7b3f)">🔖</div>
              <div>
                <h2 class="text-sm font-bold">Save Report Template</h2>
                <p class="text-[11px]" style="color:var(--text-tertiary)">Save your current filters & columns for quick access</p>
              </div>
            </div>
            <button class="btn-icon" style="width:28px;height:28px" @click="showSaveModal=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
          </div>
        </div>
        <div class="px-6 py-5 space-y-5">
          <!-- Icon picker -->
          <div>
            <label class="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style="color:var(--text-tertiary)">Choose an icon</label>
            <div class="flex gap-2 flex-wrap">
              <button v-for="ic in REPORT_ICONS" :key="ic"
                class="w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all"
                :style="{background: saveIcon===ic ? 'linear-gradient(135deg,#1da462,#0f7b3f)' : 'var(--surface-elevated)', border: saveIcon===ic ? '2px solid #1da462' : '2px solid transparent', transform: saveIcon===ic ? 'scale(1.15)' : 'scale(1)'}"
                @click="saveIcon=ic">{{ic}}</button>
            </div>
          </div>
          <!-- Name -->
          <div>
            <label class="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style="color:var(--text-tertiary)">Report name</label>
            <div class="flex items-center gap-2 px-3 py-2.5 rounded-xl" style="background:var(--surface-elevated);border:1.5px solid var(--border-subtle)">
              <span class="text-lg">{{saveIcon}}</span>
              <input v-model="saveName" class="flex-1 bg-transparent outline-none text-sm font-medium" placeholder="e.g. Q2 Active Projects · Branch LA" @keyup.enter="doSaveReport" autofocus>
            </div>
          </div>
          <!-- Active filters preview -->
          <div v-if="getFilterLabels(getCurrentFilters()).length">
            <label class="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style="color:var(--text-tertiary)">Active filters being saved</label>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="lbl in getFilterLabels(getCurrentFilters())" :key="lbl" class="px-2 py-0.5 rounded-full text-[10px] font-medium" style="background:color-mix(in srgb,var(--drive-green) 12%,transparent);color:var(--drive-green);border:1px solid color-mix(in srgb,var(--drive-green) 30%,transparent)">{{lbl}}</span>
            </div>
          </div>
          <div v-else class="text-[11px] py-2 rounded-lg px-3" style="background:var(--surface-elevated);color:var(--text-tertiary)">⚠️ No active filters — all projects will be shown when this template is applied.</div>
          <!-- Columns -->
          <div>
            <label class="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style="color:var(--text-tertiary)">Columns</label>
            <p class="text-[11px]" style="color:var(--text-secondary)">{{selectedColumns.length}} columns will be saved with this template</p>
          </div>
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
        <!-- Header -->
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
            <button class="btn-icon" style="width:28px;height:28px" @click="showLoadModal=false;deleteConfirmId=null;editingReportId=null"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
          </div>
        </div>
        <!-- Search -->
        <div class="px-5 py-3 shrink-0" style="border-bottom:1px solid var(--border-subtle)">
          <div class="relative">
            <Icon name="i-lucide-search" class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style="color:var(--text-tertiary)"/>
            <input v-model="savedReportSearch" class="input-base w-full" style="height:34px;font-size:12px;padding-left:32px" placeholder="Search saved reports...">
          </div>
        </div>
        <!-- List -->
        <div class="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <!-- Empty state -->
          <div v-if="savedReports.length === 0" class="flex flex-col items-center justify-center py-16 gap-3">
            <div class="text-5xl">📭</div>
            <p class="text-sm font-semibold" style="color:var(--text-secondary)">No saved reports yet</p>
            <p class="text-[11px]" style="color:var(--text-tertiary)">Set your filters and click "Save" to create your first template</p>
            <button class="btn-primary mt-2" @click="showLoadModal=false;openSaveModal()"><Icon name="i-lucide-bookmark-plus" class="w-3.5 h-3.5"/>Save Current Filters</button>
          </div>
          <!-- No search results -->
          <div v-else-if="filteredSavedReports.length === 0" class="text-center py-10 text-[12px]" style="color:var(--text-tertiary)">No templates match "{{savedReportSearch}}"</div>
          <!-- Report cards -->
          <div v-for="report in filteredSavedReports" :key="report.id"
            class="rounded-xl p-4 transition-all group"
            :style="{background: activeReportId===report.id ? 'color-mix(in srgb,var(--drive-green) 8%,var(--surface-elevated))' : 'var(--surface-elevated)', border: activeReportId===report.id ? '1.5px solid var(--drive-green)' : '1.5px solid var(--border-subtle)'}">
            <div class="flex items-start gap-3">
              <!-- Icon + active badge -->
              <div class="relative shrink-0">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style="background:var(--surface-card)">{{report.icon}}</div>
                <div v-if="activeReportId===report.id" class="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center" style="background:var(--drive-green)">
                  <Icon name="i-lucide-check" class="w-2.5 h-2.5 text-white"/>
                </div>
              </div>
              <!-- Content -->
              <div class="flex-1 min-w-0">
                <!-- Name row (with inline edit) -->
                <div class="flex items-center gap-2 mb-1">
                  <template v-if="editingReportId===report.id">
                    <input v-model="editingName" class="input-base flex-1 text-sm font-bold" style="height:28px;font-size:13px" @keyup.enter="confirmEditName(report)" @keyup.escape="editingReportId=null" autofocus>
                    <button class="btn-icon" style="width:26px;height:26px" @click="confirmEditName(report)"><Icon name="i-lucide-check" class="w-3.5 h-3.5" style="color:var(--drive-green)"/></button>
                    <button class="btn-icon" style="width:26px;height:26px" @click="editingReportId=null"><Icon name="i-lucide-x" class="w-3 h-3"/></button>
                  </template>
                  <template v-else>
                    <span class="text-sm font-bold truncate">{{report.name}}</span>
                    <button class="btn-icon opacity-0 group-hover:opacity-100 transition-opacity" style="width:22px;height:22px" @click.stop="startEditName(report)"><Icon name="i-lucide-pencil" class="w-3 h-3"/></button>
                  </template>
                </div>
                <!-- Filter chips -->
                <div class="flex flex-wrap gap-1 mb-2">
                  <span v-for="lbl in getFilterLabels(report.filters).slice(0,5)" :key="lbl" class="px-1.5 py-0.5 rounded text-[9px] font-medium" style="background:color-mix(in srgb,#8b5cf6 12%,transparent);color:#a78bfa;border:1px solid color-mix(in srgb,#8b5cf6 25%,transparent)">{{lbl}}</span>
                  <span v-if="getFilterLabels(report.filters).length > 5" class="px-1.5 py-0.5 rounded text-[9px] font-medium" style="background:var(--surface-card);color:var(--text-tertiary)">+{{getFilterLabels(report.filters).length - 5}} more</span>
                  <span v-if="!getFilterLabels(report.filters).length" class="text-[9px]" style="color:var(--text-tertiary)">No filters (all projects)</span>
                </div>
                <!-- Meta row -->
                <div class="flex items-center gap-3 text-[10px]" style="color:var(--text-tertiary)">
                  <span v-if="report.selectedColKeys?.length"><Icon name="i-lucide-columns" class="w-3 h-3 inline mr-0.5"/>{{report.selectedColKeys.length}} cols</span>
                  <span>Saved {{new Date(report.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}}</span>
                </div>
              </div>
              <!-- Actions -->
              <div class="flex items-center gap-1 shrink-0">
                <template v-if="deleteConfirmId===report.id">
                  <span class="text-[10px] mr-1" style="color:#ef4444">Delete?</span>
                  <button class="btn-icon" style="width:26px;height:26px;background:#ef4444" @click="doDeleteReport(report.id)"><Icon name="i-lucide-check" class="w-3 h-3 text-white"/></button>
                  <button class="btn-icon" style="width:26px;height:26px" @click="deleteConfirmId=null"><Icon name="i-lucide-x" class="w-3 h-3"/></button>
                </template>
                <template v-else>
                  <button class="btn-icon" style="width:26px;height:26px" title="Delete" @click="deleteConfirmId=report.id"><Icon name="i-lucide-trash-2" class="w-3.5 h-3.5" style="color:#ef4444"/></button>
                  <button
                    class="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                    :style="activeReportId===report.id ? 'background:var(--drive-green);color:#fff' : 'background:linear-gradient(135deg,#1da462,#0f7b3f);color:#fff'"
                    @click="applyReport(report)">
                    {{activeReportId===report.id ? '✓ Active' : 'Apply'}}
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Download Loading Overlay ──────────────────────────────────── -->
    <div v-if="downloadLoading" class="fixed inset-0 z-[60] flex items-center justify-center" style="background:rgba(0,0,0,0.65)">
      <div class="rounded-2xl px-10 py-8 flex flex-col items-center gap-4 shadow-2xl" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
        <Icon name="i-lucide-loader-2" class="w-10 h-10 animate-spin" style="color:var(--drive-green)"/>
        <div class="text-center">
          <p class="text-sm font-bold">Fetching all records…</p>
          <p class="text-[11px] mt-1" style="color:var(--text-tertiary)">This may take a few seconds for large datasets</p>
        </div>
      </div>
    </div>

    <!-- ── Column Chooser Modal (CSV) ─────────────────────────────────── -->
    <div v-if="showColChooser" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.55)" @click.self="showColChooser=false">
      <div class="rounded-xl shadow-2xl w-[580px] max-h-[85vh] flex flex-col" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
        <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--border-subtle)">
          <div>
            <h2 class="text-sm font-bold">Choose Columns to Download</h2>
            <p class="text-[11px]" style="color:var(--text-tertiary)">Select up to {{MAX_COLS}} columns. Your selection will be saved.</p>
          </div>
          <button class="btn-icon" style="width:28px;height:28px" @click="showColChooser=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
        </div>
        <!-- Search + stats bar -->
        <div class="px-4 pt-3 pb-2 flex items-center gap-3" style="border-bottom:1px solid var(--border-subtle)">
          <div class="relative flex-1">
            <Icon name="i-lucide-search" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style="color:var(--text-tertiary)"/>
            <input v-model="colSearch" class="input-base w-full" style="height:32px;font-size:12px;padding-left:30px" placeholder="Search columns..." @click.stop>
          </div>
          <span class="text-[11px] font-semibold shrink-0" style="color:var(--text-secondary)">{{pendingCols.length}} / {{MAX_COLS}}</span>
          <button class="text-[11px] shrink-0" style="color:var(--drive-green)" @click="pendingCols = columns.slice(0,MAX_COLS).map(c=>c.key)">Reset</button>
        </div>
        <div class="px-4 py-3 flex-1 overflow-y-auto">
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="col in filteredChooserCols" :key="col.key + col.label"
              class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors"
              :style="{background: pendingCols.includes(col.key) ? 'color-mix(in srgb,var(--drive-green) 15%,transparent)' : 'var(--surface-elevated)', border: pendingCols.includes(col.key) ? '1px solid var(--drive-green)' : '1px solid var(--border-subtle)', opacity: (!pendingCols.includes(col.key) && pendingCols.length >= MAX_COLS) ? '0.45' : '1', cursor: (!pendingCols.includes(col.key) && pendingCols.length >= MAX_COLS) ? 'not-allowed' : 'pointer'}"
              @click="togglePendingCol(col.key)"
            >
              <Icon :name="pendingCols.includes(col.key) ? 'i-lucide-check-square' : 'i-lucide-square'" class="w-3.5 h-3.5 shrink-0" :style="{color: pendingCols.includes(col.key) ? 'var(--drive-green)' : 'var(--text-tertiary)'}"/>
              <span class="truncate">{{col.label}}</span>
            </button>
            <p v-if="filteredChooserCols.length === 0" class="col-span-2 text-center py-6 text-xs" style="color:var(--text-tertiary)">No columns match "{{colSearch}}"</p>
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
      <div class="rounded-xl shadow-2xl w-[580px] max-h-[85vh] flex flex-col" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
        <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--border-subtle)">
          <div>
            <h2 class="text-sm font-bold">Choose Columns for PDF</h2>
            <p class="text-[11px]" style="color:var(--text-tertiary)">Select up to {{MAX_COLS}} columns for your PDF report.</p>
          </div>
          <button class="btn-icon" style="width:28px;height:28px" @click="showPdfColChooser=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
        </div>
        <!-- Search + stats bar -->
        <div class="px-4 pt-3 pb-2 flex items-center gap-3" style="border-bottom:1px solid var(--border-subtle)">
          <div class="relative flex-1">
            <Icon name="i-lucide-search" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style="color:var(--text-tertiary)"/>
            <input v-model="pdfColSearch" class="input-base w-full" style="height:32px;font-size:12px;padding-left:30px" placeholder="Search columns..." @click.stop>
          </div>
          <span class="text-[11px] font-semibold shrink-0" style="color:var(--text-secondary)">{{pendingPdfCols.length}} / {{MAX_COLS}}</span>
          <button class="text-[11px] shrink-0" style="color:#2563eb" @click="pendingPdfCols = columns.slice(0,MAX_COLS).map(c=>c.key)">Reset</button>
        </div>
        <div class="px-4 py-3 flex-1 overflow-y-auto">
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="col in filteredPdfChooserCols" :key="col.key + col.label"
              class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors"
              :style="{background: pendingPdfCols.includes(col.key) ? 'color-mix(in srgb,#2563eb 15%,transparent)' : 'var(--surface-elevated)', border: pendingPdfCols.includes(col.key) ? '1px solid #2563eb' : '1px solid var(--border-subtle)', opacity: (!pendingPdfCols.includes(col.key) && pendingPdfCols.length >= MAX_COLS) ? '0.45' : '1', cursor: (!pendingPdfCols.includes(col.key) && pendingPdfCols.length >= MAX_COLS) ? 'not-allowed' : 'pointer'}"
              @click="togglePendingPdfCol(col.key)"
            >
              <Icon :name="pendingPdfCols.includes(col.key) ? 'i-lucide-check-square' : 'i-lucide-square'" class="w-3.5 h-3.5 shrink-0" :style="{color: pendingPdfCols.includes(col.key) ? '#2563eb' : 'var(--text-tertiary)'}"/>
              <span class="truncate">{{col.label}}</span>
            </button>
            <p v-if="filteredPdfChooserCols.length === 0" class="col-span-2 text-center py-6 text-xs" style="color:var(--text-tertiary)">No columns match "{{pdfColSearch}}"</p>
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

<style scoped>
.sr-fade-enter-active, .sr-fade-leave-active { transition: all 0.2s ease; }
.sr-fade-enter-from, .sr-fade-leave-to { opacity: 0; transform: scale(0.92); }
</style>
