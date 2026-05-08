export default defineEventHandler(async () => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()

    const sql = `
      SELECT \`Row ID\`, \`First Name\`, \`Last Name\`
      FROM \`${dataset}.SalesRep\`
      WHERE \`First Name\` IS NOT NULL OR \`Last Name\` IS NOT NULL
      ORDER BY \`First Name\`, \`Last Name\`
    `

    const [rows] = await bq.query({ query: sql })
    return { salesReps: rows || [] }
  } catch (err: any) {
    console.error('BigQuery sales-reps error:', err)
    throw createError({ statusCode: 500, statusMessage: err.message || 'Failed to fetch sales reps' })
  }
})
