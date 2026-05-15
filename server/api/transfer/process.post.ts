/**
 * POST /api/transfer/process
 * 
 * Processes a single project folder: copies files not owned by admin,
 * recreates folders, archives originals to _archivedOriginals.
 * 
 * Body: { folderId: string, projectId: string }
 * Returns: { success, copied, skipped, failed }
 */
export default defineEventHandler(async (event) => {
  const { folderId, projectId } = await readBody(event)
  if (!folderId) throw createError({ statusCode: 400, statusMessage: 'folderId required' })

  const drive = useDrive()
  const TARGET_OWNER = 'admin@y2kgrouphosting.com'
  const SKIP_FOLDERS = new Set(['_Archive', '_archivedOriginals'])

  let copied = 0, skipped = 0, failed = 0

  // ── Helpers ──────────────────────────────────────────────────────────────
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

  async function moveFile(fileId: string, oldP: string, newP: string) {
    await drive.files.update({ fileId, addParents: newP, removeParents: oldP, supportsAllDrives: true })
  }

  function isOwned(f: any) {
    return (f.owners?.[0]?.emailAddress || '').toLowerCase() === TARGET_OWNER.toLowerCase()
  }

  // ── Recursive processor ──────────────────────────────────────────────────
  async function processContents(fid: string, archiveId: string) {
    const files = await listAll(fid)
    for (const file of files) {
      if (SKIP_FOLDERS.has(file.name)) continue
      if (isOwned(file)) { skipped++; continue }

      const isFolder = file.mimeType === 'application/vnd.google-apps.folder'

      if (isFolder) {
        try {
          const newId = await findOrCreate(file.name + ' ', fid)
          const children = await listAll(file.id)
          for (const c of children) {
            await moveFile(c.id, file.id, newId)
            await new Promise(r => setTimeout(r, 30))
          }
          await moveFile(file.id, fid, archiveId)
          await drive.files.update({ fileId: newId, requestBody: { name: file.name }, supportsAllDrives: true })
          copied++
          await processContents(newId, archiveId)
        } catch { failed++ }
      } else {
        try {
          await drive.files.copy({
            fileId: file.id,
            requestBody: { name: file.name, parents: [fid] },
            fields: 'id', supportsAllDrives: true,
          })
          await moveFile(file.id, fid, archiveId)
          copied++
        } catch { failed++ }
      }
      await new Promise(r => setTimeout(r, 80))
    }
  }

  // ── Main processing ──────────────────────────────────────────────────────
  try {
    const archiveId = await findOrCreate('_archivedOriginals', folderId)
    await processContents(folderId, archiveId)

    // Mark as transferred in BigQuery
    if (projectId) {
      try {
        const bq = useBigQuery()
        const dataset = getDataset()
        await bq.query({
          query: `UPDATE \`${dataset}.Projects\` SET \`isTansfered\` = true WHERE \`Project ID\` = @pid`,
          params: { pid: projectId },
        })
      } catch (e: any) {
        console.error('BQ update error:', e.message)
      }
    }

    return { success: true, copied, skipped, failed }
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err.message || 'Processing failed' })
  }
})
