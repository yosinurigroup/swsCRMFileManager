/**
 * GET /api/transfer/auto-trigger
 *
 * Lightweight endpoint that checks if there are pending projects
 * and processes ONE project per invocation (to stay within Vercel's function timeout).
 *
 * Call this on a schedule (Vercel Cron, UptimeRobot, or external cron) to
 * automatically process transfers 24/7 without a browser tab.
 *
 * Query params:
 *   ?key=<AUTH_API_KEY>  — must match NUXT_AUTH_API_KEY for security
 */
export default defineEventHandler(async (event) => {
  // Simple auth check
  const { key } = getQuery(event) as { key?: string }
  const { auth } = useRuntimeConfig()
  if (!key || key !== auth.apiKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const drive = useDrive()
  const bq = useBigQuery()
  const dataset = getDataset()

  const TARGET_OWNER = 'admin@y2kgrouphosting.com'
  const SKIP_FOLDERS = new Set(['_Archive', '_archivedOriginals'])

  // ── Get one pending project from BigQuery ──
  const [rows] = await bq.query({
    query: `SELECT \`Project ID\` as Project_ID, \`Customer Address\` as Customer_Address, \`Project Folder\` as Project_Folder 
            FROM \`${dataset}.Projects\` 
            WHERE (\`isTansfered\` IS NULL OR \`isTansfered\` = false) 
            AND \`Project Folder\` IS NOT NULL AND \`Project Folder\` != '' 
            LIMIT 1`,
  })

  if (!rows || rows.length === 0) {
    return { success: true, message: 'No pending projects', processed: 0 }
  }

  const project = rows[0] as any
  const folderUrl = project.Project_Folder || ''
  const m = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/)
  const folderId = m?.[1]

  if (!folderId) {
    // Mark as transferred since there's no valid folder
    await bq.query({
      query: `UPDATE \`${dataset}.Projects\` SET \`isTansfered\` = true WHERE \`Project ID\` = @pid`,
      params: { pid: project.Project_ID },
    })
    return { success: true, message: 'Invalid folder URL — skipped', projectId: project.Project_ID }
  }

  // ── Helpers ──
  async function listAll(fid: string) {
    const files: any[] = []
    let pt: string | undefined
    do {
      const r = await drive.files.list({
        q: `'${fid}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, owners)',
        orderBy: 'folder,name', pageSize: 1000,
        supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken: pt,
      })
      if (r.data.files) files.push(...r.data.files)
      pt = r.data.nextPageToken || undefined
    } while (pt)
    return files
  }

  async function findOrCreate(name: string, parentId: string) {
    const e = await drive.files.list({
      q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)', supportsAllDrives: true,
    })
    if (e.data.files?.length) return e.data.files[0]!.id!
    const r = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id', supportsAllDrives: true,
    })
    return r.data.id!
  }

  function getOwner(f: any) { return f.owners?.[0]?.emailAddress || 'unknown' }
  function isOwned(f: any) { return getOwner(f).toLowerCase() === TARGET_OWNER.toLowerCase() }

  let copied = 0, skipped = 0, failed = 0

  // ── Process (non-recursive — just top-level to stay within timeout) ──
  try {
    const archiveId = await findOrCreate('_archivedOriginals', folderId)
    const files = await listAll(folderId)

    for (const file of files) {
      if (SKIP_FOLDERS.has(file.name)) continue

      if (isOwned(file)) { skipped++; continue }

      const isFolder = file.mimeType === 'application/vnd.google-apps.folder'

      if (isFolder) {
        try {
          const newId = await findOrCreate(file.name + ' ', folderId)
          const children = await listAll(file.id)
          for (const c of children) {
            await drive.files.update({ fileId: c.id, addParents: newId, removeParents: file.id, supportsAllDrives: true })
          }
          await drive.files.update({ fileId: file.id, addParents: archiveId, removeParents: folderId, supportsAllDrives: true })
          await drive.files.update({ fileId: newId, requestBody: { name: file.name }, supportsAllDrives: true })
          copied++
        } catch { failed++ }
      } else {
        try {
          await drive.files.copy({
            fileId: file.id,
            requestBody: { name: file.name, parents: [folderId] },
            fields: 'id', supportsAllDrives: true,
          })
          await drive.files.update({ fileId: file.id, addParents: archiveId, removeParents: folderId, supportsAllDrives: true })
          copied++
        } catch { failed++ }
      }
    }

    // Mark as transferred
    await bq.query({
      query: `UPDATE \`${dataset}.Projects\` SET \`isTansfered\` = true WHERE \`Project ID\` = @pid`,
      params: { pid: project.Project_ID },
    })
  } catch (err: any) {
    return { success: false, message: err.message, projectId: project.Project_ID, copied, skipped, failed }
  }

  return {
    success: true,
    projectId: project.Project_ID,
    address: project.Customer_Address,
    copied, skipped, failed,
  }
})
