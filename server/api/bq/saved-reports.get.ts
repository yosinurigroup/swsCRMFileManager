/**
 * GET /api/bq/saved-reports?userEmail=...&reportType=general|pmweekly
 * Returns all saved report templates for a given user + report type.
 */
export default defineEventHandler(async (event) => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()
    const query = getQuery(event) as Record<string, string>

    const userEmail = (query.userEmail || '').trim().toLowerCase()
    const reportType = (query.reportType || '').trim()

    if (!userEmail) throw createError({ statusCode: 400, statusMessage: 'userEmail is required' })
    if (!reportType) throw createError({ statusCode: 400, statusMessage: 'reportType is required' })

    const sql = `
      SELECT *
      FROM \`${dataset}.SavedReports\`
      WHERE user_email = @userEmail
        AND report_type = @reportType
        AND is_deleted = FALSE
      ORDER BY updated_at DESC
    `

    const [rows] = await bq.query({ query: sql, params: { userEmail, reportType } })

    const templates = (rows || []).map((r: any) => ({
      id:             r.id,
      name:           r.name,
      icon:           r.icon || '📊',
      createdAt:      r.created_at?.value || r.created_at,
      updatedAt:      r.updated_at?.value || r.updated_at,
      reportType:     r.report_type,
      filters:        r.filters_json    ? JSON.parse(r.filters_json)     : {},
      selectedColKeys: r.col_keys_json  ? JSON.parse(r.col_keys_json)    : [],
    }))

    return { templates }
  } catch (err: any) {
    console.error('saved-reports GET error:', err)
    throw createError({ statusCode: 500, statusMessage: err.message || 'Failed to fetch saved reports' })
  }
})
