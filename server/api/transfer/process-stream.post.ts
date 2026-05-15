/**
 * POST /api/transfer/process-stream
 *
 * SSE endpoint — streams real-time progress as each file/folder is processed.
 * Body: { folderId, projectId }
 */
export default defineEventHandler(async (event) => {
  const { folderId, projectId } = await readBody(event)
  if (!folderId) throw createError({ statusCode: 400, statusMessage: 'folderId required' })

  // Set SSE headers
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const drive = useDrive()
  const TARGET_OWNER = 'admin@y2kgrouphosting.com'
  const SKIP_FOLDERS = new Set(['_Archive', '_archivedOriginals'])
  let copied = 0, skipped = 0, failed = 0

  // Send SSE event
  function send(type: string, data: any) {
    const payload = JSON.stringify({ type, ...data })
    event.node.res.write(`data: ${payload}\n\n`)
  }

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

  function getOwner(f: any) { return f.owners?.[0]?.emailAddress || 'unknown' }
  function isOwned(f: any) { return getOwner(f).toLowerCase() === TARGET_OWNER.toLowerCase() }

  // ── Recursive processor ──────────────────────────────────────────────────
  async function processContents(fid: string, archiveId: string, depth: number = 0) {
    const files = await listAll(fid)
    send('scan', { depth, count: files.length })

    for (const file of files) {
      if (SKIP_FOLDERS.has(file.name)) continue
      const owner = getOwner(file)

      if (isOwned(file)) {
        skipped++
        send('skip', { name: file.name, depth, copied, skipped, failed })
        continue
      }

      const isFolder = file.mimeType === 'application/vnd.google-apps.folder'

      if (isFolder) {
        send('folder_start', { name: file.name, owner, depth })
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
          send('folder_done', { name: file.name, depth, copied, skipped, failed })
          await processContents(newId, archiveId, depth + 1)
        } catch (err: any) {
          failed++
          send('folder_error', { name: file.name, error: err.message, depth, copied, skipped, failed })
        }
      } else {
        send('file_start', { name: file.name, owner, depth })
        try {
          await drive.files.copy({
            fileId: file.id,
            requestBody: { name: file.name, parents: [fid] },
            fields: 'id', supportsAllDrives: true,
          })
          await moveFile(file.id, fid, archiveId)
          copied++
          send('file_done', { name: file.name, depth, copied, skipped, failed })
        } catch (err: any) {
          failed++
          send('file_error', { name: file.name, error: err.message, depth, copied, skipped, failed })
        }
      }
      await new Promise(r => setTimeout(r, 80))
    }
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  try {
    send('start', { folderId })
    const archiveId = await findOrCreate('_archivedOriginals', folderId)
    await processContents(folderId, archiveId, 0)

    // Mark as transferred in BigQuery
    if (projectId) {
      try {
        const bq = useBigQuery()
        const dataset = getDataset()
        await bq.query({
          query: `UPDATE \`${dataset}.Projects\` SET \`isTansfered\` = true WHERE \`Project ID\` = @pid`,
          params: { pid: projectId },
        })
      } catch {}
    }

    send('complete', { copied, skipped, failed })
  } catch (err: any) {
    send('error', { message: err.message })
  }

  event.node.res.end()
})
