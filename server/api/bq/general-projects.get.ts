export default defineEventHandler(async (event) => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()

    const query = getQuery(event) as Record<string, string>

    // Build WHERE clause
    let where = '(TempDeleted IS NULL OR TempDeleted != true)'
    const params: Record<string, any> = {}

    // Date filter
    if (query.dateOf && query.dateFrom && query.dateTo) {
      const dateFieldMap: Record<string, string> = {
        'SSA': 'SSA',
        'Solar Install': 'Solar Install',
        'MPU Install': 'MPU Installed',
        'Battery Install': 'Battery Installed',
        'Completion': 'Completion Date',
        'Final': 'Final Date',
        'Start-up / Monitor': 'Start-Up Monitor',
        'Contract Sign': 'Contract sign Date',
      }
      const field = dateFieldMap[query.dateOf]
      if (field) {
        // Explicitly cast both sides to DATE so BigQuery doesn't attempt
        // implicit string→date coercion (which can silently fail)
        where += ` AND CAST(\`${field}\` AS DATE)
                   BETWEEN CAST(@dateFrom AS DATE) AND CAST(@dateTo AS DATE)`
        params.dateFrom = query.dateFrom
        params.dateTo = query.dateTo
      }
    }

    // Simple string filters (multi-select: comma-separated values)
    const filterMap: Record<string, string> = {
      branch: 'Branch Name',
      vendor: 'Vendor',
      salesRep: 'Sales Rep',
      projectType: 'Project Type',
      projectManager: 'Project Manager',
      financeManager: 'Finance Manager',
      engineer: 'Engineer',
      permitCoordinator: 'Permit Coordinator',
      utility: 'Utillity',
      solarEquipment: 'Solar Equipment',
    }

    for (const [param, column] of Object.entries(filterMap)) {
      if (query[param]) {
        const values = query[param].split(',').map((v: string) => v.trim()).filter(Boolean)
        if (values.length === 1) {
          const paramName = `f_${param}`
          where += ` AND LOWER(\`${column}\`) = LOWER(@${paramName})`
          params[paramName] = values[0]
        } else if (values.length > 1) {
          const paramName = `f_${param}_arr`
          where += ` AND LOWER(\`${column}\`) IN UNNEST(@${paramName})`
          params[paramName] = values.map((v: string) => v.toLowerCase())
        }
      }
    }

    // Status fields use LIKE (values may be comma/slash separated in DB)
    // Multi-select: match if ANY selected value is contained in the field
    const likeFields: Record<string, string> = {
      jobStatus: 'Job Status',
      projectStatus: 'Project Status',
      ssaStatus: 'SSA Status',
      solarInstallStatus: 'Solar Install Status',
      completionStatus: 'Completion Status',
      finalStatus: 'Final Status',
    }
    for (const [param, column] of Object.entries(likeFields)) {
      if (query[param]) {
        const values = query[param].split(',').map((v: string) => v.trim()).filter(Boolean)
        if (values.length === 1) {
          const paramName = `like_${param}`
          where += ` AND LOWER(\`${column}\`) LIKE LOWER(CONCAT('%', @${paramName}, '%'))`
          params[paramName] = values[0]
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

    // Get total count (no limit)
    const countSql = `SELECT COUNT(*) as total FROM \`${dataset}.Projects\` WHERE ${where}`
    const [countResult] = await bq.query({ query: countSql, params })
    const totalCount = countResult[0]?.total || 0

    // Pagination
    const limit = parseInt(query.limit || '100', 10)
    const offset = parseInt(query.offset || '0', 10)

    const sql = `
      SELECT *
      FROM \`${dataset}.Projects\`
      WHERE ${where}
      ORDER BY \`TimeStamp\` DESC
      LIMIT @limit OFFSET @offset
    `

    params.limit = limit
    params.offset = offset

    const [rows] = await bq.query({ query: sql, params })
    return { projects: rows || [], total: totalCount }
  } catch (err: any) {
    console.error('BigQuery general-projects error:', err)
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'Failed to fetch general projects',
    })
  }
})
