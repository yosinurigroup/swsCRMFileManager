/**
 * POST /api/bq/saved-reports
 * Body: { userEmail, reportType, id?, name, icon, filters, selectedColKeys? }
 *
 * Upserts a saved report template using BigQuery MERGE.
 */
export default defineEventHandler(async (event) => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()
    const body = await readBody(event)

    const userEmail    = (body.userEmail  || '').trim().toLowerCase()
    const reportType   = (body.reportType || '').trim()
    const name         = (body.name       || '').trim()
    const icon         = (body.icon       || '📊').trim()
    const filtersJson  = JSON.stringify(body.filters        || {})
    const colKeysJson  = JSON.stringify(body.selectedColKeys || [])
    const id           = body.id || generateId()

    if (!userEmail)  throw createError({ statusCode: 400, statusMessage: 'userEmail is required' })
    if (!reportType) throw createError({ statusCode: 400, statusMessage: 'reportType is required' })
    if (!name)       throw createError({ statusCode: 400, statusMessage: 'name is required' })

    // Use CURRENT_TIMESTAMP() directly in SQL to avoid string→TIMESTAMP type issues
    const sql = `
      MERGE \`${dataset}.SavedReports\` AS target
      USING (
        SELECT
          @id           AS id,
          @userEmail    AS user_email,
          @reportType   AS report_type,
          @name         AS name,
          @icon         AS icon,
          @filtersJson  AS filters_json,
          @colKeysJson  AS col_keys_json
      ) AS source
      ON target.id = source.id AND target.user_email = source.user_email

      WHEN MATCHED THEN
        UPDATE SET
          name          = source.name,
          icon          = source.icon,
          filters_json  = source.filters_json,
          col_keys_json = source.col_keys_json,
          is_deleted    = FALSE,
          updated_at    = CURRENT_TIMESTAMP()

      WHEN NOT MATCHED THEN
        INSERT (id, user_email, report_type, name, icon, filters_json, col_keys_json, is_deleted, created_at, updated_at)
        VALUES (
          source.id, source.user_email, source.report_type,
          source.name, source.icon, source.filters_json, source.col_keys_json,
          FALSE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
        )
    `

    await bq.query({
      query: sql,
      params: { id, userEmail, reportType, name, icon, filtersJson, colKeysJson },
    })

    return { success: true, id }
  } catch (err: any) {
    console.error('saved-reports POST error:', err)
    throw createError({ statusCode: 500, statusMessage: err.message || 'Failed to save report' })
  }
})

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
