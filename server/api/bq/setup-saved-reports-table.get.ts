/**
 * GET /api/bq/setup-saved-reports-table
 *
 * One-time setup endpoint. Hit this once to create the SavedReports table.
 * DELETE this file after running.
 */
export default defineEventHandler(async (_event) => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()
    const config = useRuntimeConfig()
    const projectId = config.bigquery.projectId

    const DDL = `
      CREATE TABLE IF NOT EXISTS \`${projectId}.${dataset}.SavedReports\` (
        id            STRING    NOT NULL,
        user_email    STRING    NOT NULL,
        report_type   STRING    NOT NULL,
        name          STRING    NOT NULL,
        icon          STRING,
        filters_json  STRING,
        col_keys_json STRING,
        is_deleted    BOOL      NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMP NOT NULL,
        updated_at    TIMESTAMP NOT NULL
      )
      OPTIONS (
        description = 'Saved report filter/column templates per user'
      )
    `

    await bq.query({ query: DDL })

    return {
      success: true,
      message: `Table SavedReports created (or already exists) in ${projectId}.${dataset}`,
      note: 'You can now delete /server/api/bq/setup-saved-reports-table.get.ts',
    }
  } catch (err: any) {
    console.error('Table setup error:', err)
    throw createError({ statusCode: 500, statusMessage: err.message })
  }
})
