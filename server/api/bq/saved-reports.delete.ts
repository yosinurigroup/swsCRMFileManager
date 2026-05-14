/**
 * DELETE /api/bq/saved-reports?id=...&userEmail=...
 * Soft-deletes (sets is_deleted = TRUE) so the row stays for audit history.
 */
export default defineEventHandler(async (event) => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()
    const query = getQuery(event) as Record<string, string>

    const id        = (query.id        || '').trim()
    const userEmail = (query.userEmail || '').trim().toLowerCase()

    if (!id)        throw createError({ statusCode: 400, statusMessage: 'id is required' })
    if (!userEmail) throw createError({ statusCode: 400, statusMessage: 'userEmail is required' })

    const now = new Date().toISOString()

    const sql = `
      UPDATE \`${dataset}.SavedReports\`
      SET is_deleted = TRUE, updated_at = @now
      WHERE id = @id AND user_email = @userEmail
    `

    await bq.query({ query: sql, params: { id, userEmail, now } })

    return { success: true }
  } catch (err: any) {
    console.error('saved-reports DELETE error:', err)
    throw createError({ statusCode: 500, statusMessage: err.message || 'Failed to delete report' })
  }
})
