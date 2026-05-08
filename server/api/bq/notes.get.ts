export default defineEventHandler(async (event) => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()
    const query = getQuery(event) as { projectIds?: string }

    if (!query.projectIds) return { notes: [] }

    const ids = query.projectIds.split(',').filter(Boolean)
    if (ids.length === 0) return { notes: [] }

    // Build parameterized IN clause
    const placeholders = ids.map((_, i) => `@id_${i}`).join(',')
    const params: Record<string, string> = {}
    ids.forEach((id, i) => { params[`id_${i}`] = id })

    // Query BOTH Notes and NotesClosed tables (matching source CRM)
    const sqlActive = `
      SELECT ProjectId, Note, \`Time Stamp\`
      FROM \`${dataset}.Notes\`
      WHERE ProjectId IN (${placeholders})
        AND Note IS NOT NULL AND TRIM(Note) != ''
      ORDER BY \`Time Stamp\` ASC
    `
    const sqlClosed = `
      SELECT ProjectId, Note, \`Time Stamp\`
      FROM \`${dataset}.NotesClosed\`
      WHERE ProjectId IN (${placeholders})
        AND Note IS NOT NULL AND TRIM(Note) != ''
      ORDER BY \`Time Stamp\` ASC
    `

    // Fetch both in parallel
    const [activeResult, closedResult] = await Promise.all([
      bq.query({ query: sqlActive, params }).catch(() => [[]]),
      bq.query({ query: sqlClosed, params }).catch(() => [[]]),
    ])

    const activeRows = activeResult[0] || []
    const closedRows = closedResult[0] || []

    // Merge all notes
    const allNotes = [...activeRows, ...closedRows]

    return { notes: allNotes }
  } catch (err: any) {
    console.error('BigQuery notes error:', err)
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'Failed to fetch notes',
    })
  }
})
