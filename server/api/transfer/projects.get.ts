/**
 * GET /api/transfer/projects
 * Returns all projects with their folder URLs and transfer status.
 */
export default defineEventHandler(async () => {
  const bq = useBigQuery()
  const dataset = getDataset()

  const sql = `
    SELECT
      \`Project ID\`,
      \`Customer Address\`,
      \`Project Folder\`,
      \`isTransfered\`
    FROM \`${dataset}.Projects\`
    WHERE (TempDeleted IS NULL OR TempDeleted != true)
      AND \`Project Folder\` IS NOT NULL
      AND \`Project Folder\` != ''
    ORDER BY \`TimeStamp\` DESC
  `

  const [rows] = await bq.query({ query: sql })
  return { projects: rows || [] }
})
