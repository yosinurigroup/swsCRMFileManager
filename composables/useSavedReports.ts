export interface ReportTemplate {
  id: string
  name: string
  icon: string
  createdAt: string
  updatedAt?: string
  reportType?: string
  filters: {
    dateOf?: string
    dateFrom?: string
    dateTo?: string
    branch?: string
    vendor?: string
    salesRep?: string
    projectType?: string
    jobStatus?: string
    projectStatus?: string
    projectManager?: string
    financeManager?: string
    engineer?: string
    permitCoordinator?: string
    utility?: string
    solarEquipment?: string
    ssaStatus?: string
    solarInstallStatus?: string
    completionStatus?: string
    finalStatus?: string
    search?: string
  }
  selectedColKeys?: string[]
}

/**
 * useSavedReports(reportKey)
 *
 * All reads/writes go to BigQuery via server API routes.
 * localStorage is used only as a fast local cache to avoid flicker on page load.
 */
export function useSavedReports(reportKey: string) {
  function cacheKey(userEmail: string) {
    return `sr_cache_${reportKey}_${encodeURIComponent(userEmail)}_v2`
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────
  function readCache(userEmail: string): ReportTemplate[] {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem(cacheKey(userEmail)) || '[]') } catch { return [] }
  }

  function writeCache(userEmail: string, data: ReportTemplate[]) {
    if (typeof window === 'undefined') return
    try { localStorage.setItem(cacheKey(userEmail), JSON.stringify(data)) } catch {}
  }

  // ── Remote API ─────────────────────────────────────────────────────────────

  /** Fetch all templates from BigQuery. Updates local cache. */
  async function list(userEmail: string): Promise<ReportTemplate[]> {
    if (!userEmail) return []
    try {
      const res = await $fetch<{ templates: ReportTemplate[] }>('/api/bq/saved-reports', {
        params: { userEmail, reportType: reportKey },
      })
      const templates = res.templates || []
      writeCache(userEmail, templates)
      return templates
    } catch (err) {
      console.warn('useSavedReports: falling back to cache', err)
      return readCache(userEmail)
    }
  }

  /** Save or update a template. Also patches the local cache immediately. */
  async function save(template: ReportTemplate, userEmail: string): Promise<void> {
    if (!userEmail) return
    // Optimistic: update cache immediately
    const cached = readCache(userEmail)
    const idx = cached.findIndex(r => r.id === template.id)
    if (idx >= 0) cached[idx] = template
    else cached.unshift(template)
    writeCache(userEmail, cached)

    // Persist to BigQuery
    await $fetch('/api/bq/saved-reports', {
      method: 'POST',
      body: {
        userEmail,
        reportType:      reportKey,
        id:              template.id,
        name:            template.name,
        icon:            template.icon,
        filters:         template.filters,
        selectedColKeys: template.selectedColKeys || [],
      },
    })
  }

  /** Soft-delete a template. Also removes from local cache immediately. */
  async function remove(id: string, userEmail: string): Promise<void> {
    if (!userEmail) return
    // Optimistic: remove from cache immediately
    const cached = readCache(userEmail).filter(r => r.id !== id)
    writeCache(userEmail, cached)

    // Persist to BigQuery
    await $fetch('/api/bq/saved-reports', {
      method: 'DELETE',
      params: { id, userEmail },
    })
  }

  /** Rename a template (patch name only). */
  async function update(id: string, patch: Partial<ReportTemplate>, userEmail: string): Promise<void> {
    const cached = readCache(userEmail)
    const target = cached.find(r => r.id === id)
    if (!target) return
    const updated = { ...target, ...patch }
    await save(updated, userEmail)
  }

  /** Get the cached list synchronously (for initial render before async load). */
  function listSync(userEmail: string): ReportTemplate[] {
    return readCache(userEmail)
  }

  return { list, listSync, save, remove, update }
}

export const REPORT_ICONS = ['📊','📋','⭐','🎯','💼','🗂️','📌','🏆','🔍','📈','🌿','🔵','🟢','🟡','🔴']
