export default defineEventHandler(async (event) => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()
    const query = getQuery(event) as Record<string, string>

    // Build WHERE clause (same logic as projects.get.ts)
    let where = '(TempDeleted IS NULL OR TempDeleted != true)'
    const params: Record<string, any> = {}

    // Date filter
    if (query.dateOf && query.dateFrom && query.dateTo) {
      const dateFieldMap: Record<string, string> = {
        'SSA': 'SSA', 'Solar Install': 'Solar Install',
        'MPU Install': 'MPU Installed', 'Battery Install': 'Battery Installed',
        'Completion': 'Completion Date', 'Final': 'Final Date',
        'Start-up / Monitor': 'Start-Up Monitor',
      }
      const field = dateFieldMap[query.dateOf]
      if (field) {
        where += ` AND \`${field}\` >= @dateFrom AND \`${field}\` <= @dateTo`
        params.dateFrom = query.dateFrom
        params.dateTo = query.dateTo
      }
    }

    // Exact match filters (multi-select: comma-separated values)
    const filterMap: Record<string, string> = {
      branch: 'Branch Name', vendor: 'Vendor', salesRep: 'Sales Rep',
      projectType: 'Project Type', projectManager: 'Project Manager',
      financeManager: 'Finance Manager', engineer: 'Engineer',
      permitCoordinator: 'Permit Coordinator', utility: 'Utillity',
      solarEquipment: 'Solar Equipment',
    }
    for (const [param, column] of Object.entries(filterMap)) {
      if (query[param]) {
        const values = query[param].split(',').map((v: string) => v.trim()).filter(Boolean)
        if (values.length === 1) {
          const pn = `f_${param}`
          where += ` AND LOWER(\`${column}\`) = LOWER(@${pn})`
          params[pn] = values[0]
        } else if (values.length > 1) {
          const pn = `f_${param}_arr`
          where += ` AND LOWER(\`${column}\`) IN UNNEST(@${pn})`
          params[pn] = values.map((v: string) => v.toLowerCase())
        }
      }
    }

    // LIKE filters (status fields) — multi-select support
    const likeMap: Record<string, string> = {
      jobStatus: 'Job Status', projectStatus: 'Project Status',
      ssaStatus: 'SSA Status', solarInstallStatus: 'Solar Install Status',
      completionStatus: 'Completion Status', finalStatus: 'Final Status',
    }
    for (const [param, column] of Object.entries(likeMap)) {
      if (query[param]) {
        const values = query[param].split(',').map((v: string) => v.trim()).filter(Boolean)
        if (values.length === 1) {
          const pn = `like_${param}`
          where += ` AND LOWER(\`${column}\`) LIKE LOWER(CONCAT('%', @${pn}, '%'))`
          params[pn] = values[0]
        } else if (values.length > 1) {
          const conditions = values.map((_: string, i: number) => {
            const pn = `like_${param}_${i}`
            params[pn] = values[i]
            return `LOWER(\`${column}\`) LIKE LOWER(CONCAT('%', @${pn}, '%'))`
          })
          where += ` AND (${conditions.join(' OR ')})`
        }
      }
    }

    // Count records per distinct value for each filter column
    const columns: Record<string, string> = {
      branches: 'Branch Name', vendors: 'Vendor', salesReps: 'Sales Rep',
      projectTypes: 'Project Type', projectManagers: 'Project Manager',
      financeManagers: 'Finance Manager', engineers: 'Engineer',
      permitCoordinators: 'Permit Coordinator', utilities: 'Utillity',
      solarEquipment: 'Solar Equipment', jobStatuses: 'Job Status',
      projectStatuses: 'Project Status', ssaStatuses: 'SSA Status',
      solarInstallStatuses: 'Solar Install Status',
      completionStatuses: 'Completion Status', finalStatuses: 'Final Status',
    }

    // Run all count queries in parallel
    const entries = Object.entries(columns)
    const queries = entries.map(([, col]) => {
      const sql = `SELECT \`${col}\` AS val, COUNT(*) AS cnt FROM \`${dataset}.Projects\` WHERE ${where} AND \`${col}\` IS NOT NULL AND TRIM(\`${col}\`) != '' GROUP BY \`${col}\``
      return bq.query({ query: sql, params })
    })

    const results = await Promise.all(queries)

    const counts: Record<string, Record<string, number>> = {}
    entries.forEach(([key], i) => {
      counts[key] = {}
      const result = results[i]
      if (!result) return
      const rows = result[0] || []
      for (const row of rows) {
        if (row.val) counts[key][row.val] = row.cnt
      }
    })

    return counts
  } catch (err: any) {
    console.error('BigQuery filter-counts error:', err)
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'Failed to fetch filter counts',
    })
  }
})
