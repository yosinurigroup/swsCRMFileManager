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
        'Contract Sign': 'Contract Sign',
      }
      const field = dateFieldMap[query.dateOf]
      if (field) {
        where += ` AND \`${field}\` >= @dateFrom AND \`${field}\` <= @dateTo`
        params.dateFrom = query.dateFrom
        params.dateTo = query.dateTo
      }
    }

    // Simple string filters
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
        const paramName = `f_${param}`
        where += ` AND LOWER(\`${column}\`) = LOWER(@${paramName})`
        params[paramName] = query[param]
      }
    }

    // Status fields use LIKE (values may be comma/slash separated in DB)
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
        const paramName = `like_${param}`
        where += ` AND LOWER(\`${column}\`) LIKE LOWER(CONCAT('%', @${paramName}, '%'))`
        params[paramName] = query[param]
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
      SELECT
        \`Project ID\`,
        \`Customer Address\`,
        \`Project Type\`,
        \`Job Status\`,
        \`Project Status\`,
        \`Project Equipment\`,
        \`Contract Sign\`,
        \`SSA\`,
        \`SSA Status\`,
        \`Solar Install\`,
        \`Solar Install Status\`,
        \`MPU Installed\`,
        \`MPU Install Status\`,
        \`Battery Installed\`,
        \`Battery Install Status\`,
        \`Completion Date\`,
        \`Completion Status\`,
        \`Final Date\`,
        \`Final Status\`,
        \`Start-Up Monitor\`,
        \`Start-Up Monitor Status\`,
        \`Branch Name\`,
        \`Vendor\`,
        \`Sales Rep\`,
        \`Permit Coordinator\`,
        \`Engineer\`,
        \`Utillity\`,
        \`Panels Amount\`,
        \`Watt\`,
        \`KW\`,
        \`Solar Equipment\`,
        \`Project Manager\`,
        \`Secondary Project Manager\`,
        \`Project Price\`,
        \`Project Manager VA\`,
        \`Secondary Project Manager VA\`,
        \`Finance Manager\`,
        \`Secondary Finance Manager\`,
        \`Finance Manager VA\`,
        \`Finance Companies\`,
        \`Project Close\`,
        \`Finance Ready\`,
        \`PM Approve Project\`,
        \`Cold Water Re-Location\`,
        \`EV Charger ft\`,
        \`Trenching ft\`,
        \`Solar Removal Amount\`,
        \`MPU Location\`,
        \`MPU Distance ft\`,
        \`Trenching Type\`,
        \`Sub-Panel Amp\`,
        \`Derate Amp\`,
        \`Fire Approval Needed\`,
        \`Inverter Type\`,
        \`Batteries Qty\`,
        \`Sub Panel Qty\`,
        \`ESR Phone\`,
        \`Fire Department Email\`,
        \`Fire Department Phone\`,
        \`Fire Department Inspector Email\`,
        \`Fire Department Inspector Phone\`,
        \`Fire Inspection\`,
        \`Exisiting System\`,
        \`Trench Fill\`,
        \`Stucco Status\`,
        \`Trench Fill Status\`,
        \`Combiner Box\`,
        \`Service\`,
        \`WR#\`,
        \`SR#\`,
        \`SBP#\`,
        \`AHJ\`,
        \`Last Activity Date\`,
        \`NTP\`,
        \`TimeStamp\`
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
