export default defineEventHandler(async () => {
  try {
    const bq = useBigQuery()
    const dataset = getDataset()

    const sql = `
      SELECT Email, \`First Name\`, \`Last Name\`, Role
      FROM \`${dataset}.Users\`
      WHERE Email IS NOT NULL AND Email != ''
    `

    const [rows] = await bq.query({ query: sql })
    return { users: rows || [] }
  } catch (err: any) {
    console.error('BigQuery users error:', err)
    throw createError({ statusCode: 500, statusMessage: err.message || 'Failed to fetch users' })
  }
})
