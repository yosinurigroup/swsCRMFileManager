export default defineEventHandler(async () => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()

    const sql = `
      SELECT \`Row ID\`, \`Vendor Name\`
      FROM \`${dataset}.Vendors\`
      WHERE \`Vendor Name\` IS NOT NULL AND TRIM(\`Vendor Name\`) != ''
      ORDER BY \`Vendor Name\`
    `

    const [rows] = await bq.query({ query: sql })
    return { vendors: rows || [] }
  } catch (err: any) {
    console.error('BigQuery vendors error:', err)
    throw createError({ statusCode: 500, statusMessage: err.message || 'Failed to fetch vendors' })
  }
})
