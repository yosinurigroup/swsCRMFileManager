/**
 * POST /api/bq/saved-reports
 * Body: { userEmail, reportType, id?, name, icon, filters, selectedColKeys? }
 *
 * If `id` exists → UPDATE (upsert); if no `id` → INSERT with generated UUID.
 * Uses BigQuery MERGE for idempotent upsert.
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
    const filtersJson  = JSON.stringify(body.filters       || {})
    const colKeysJson  = JSON.stringify(body.selectedColKeys || [])
    const id           = body.id || generateId()
    const now          = new Date().toISOString()

    if (!userEmail)  throw createError({ statusCode: 400, statusMessage: 'userEmail is required' })
    if (!reportType) throw createError({ statusCode: 400, statusMessage: 'reportType is required' })
    if (!name)       throw createError({ statusCode: 400, statusMessage: 'name is required' })

    // MERGE: upsert by id + user_email
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
          @colKeysJson  AS col_keys_json,
          FALSE         AS is_deleted,
          @now          AS created_at,
          @now          AS updated_at
      ) AS source
      ON target.id = source.id AND target.user_email = source.user_email

      WHEN MATCHED THEN
        UPDATE SET
          name          = source.name,
          icon          = source.icon,
          filters_json  = source.filters_json,
          col_keys_json = source.col_keys_json,
          is_deleted    = FALSE,
          updated_at    = source.updated_at

      WHEN NOT MATCHED THEN
        INSERT (id, user_email, report_type, name, icon, filters_json, col_keys_json, is_deleted, created_at, updated_at)
        VALUES (source.id, source.user_email, source.report_type, source.name, source.icon, source.filters_json, source.col_keys_json, FALSE, source.created_at, source.updated_at)
    `

    await bq.query({
      query: sql,
      params: { id, userEmail, reportType, name, icon, filtersJson, colKeysJson, now },
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
