/**
 * POST /api/drive/transfer-ownership
 * 
 * Recursively transfers ownership of all files & folders
 * in a given Google Drive folder to admin@y2kgrouphosting.com
 * 
 * Body: { folderId: string }
 * 
 * Returns a streaming JSON log of progress.
 */
export default defineEventHandler(async (event) => {
  const TARGET_OWNER = 'admin@y2kgrouphosting.com'

  const { folderId } = await readBody(event)
  if (!folderId) {
    throw createError({ statusCode: 400, statusMessage: 'folderId is required' })
  }

  const drive = useDrive()

  let transferred = 0
  let skipped = 0
  let failed = 0
  let total = 0
  const log: string[] = []

  function addLog(msg: string) {
    log.push(msg)
    console.log(msg)
  }

  // List all files in a folder (handles pagination)
  async function listAllFiles(fid: string) {
    const files: any[] = []
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `'${fid}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, owners)',
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      })
      if (res.data.files) files.push(...res.data.files)
      pageToken = res.data.nextPageToken || undefined
    } while (pageToken)
    return files
  }

  // Transfer ownership of a single file
  async function transferOne(fileId: string, fileName: string) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'owner',
          type: 'user',
          emailAddress: TARGET_OWNER,
        },
        transferOwnership: true,
        supportsAllDrives: true,
      })
      transferred++
      addLog(`✅ Transferred: ${fileName}`)
    } catch (err: any) {
      const msg = err.message || err.errors?.[0]?.message || 'Unknown error'
      if (msg.includes('already') || msg.includes('owner')) {
        skipped++
        addLog(`⏭️ Already owned: ${fileName}`)
      } else {
        failed++
        addLog(`❌ Failed: ${fileName} — ${msg}`)
      }
    }
  }

  // Recursively process a folder
  async function processFolder(fid: string, path: string) {
    const files = await listAllFiles(fid)
    addLog(`📂 ${path} — ${files.length} items`)

    for (const file of files) {
      total++
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
      const ownerEmail = file.owners?.[0]?.emailAddress || 'unknown'

      if (ownerEmail.toLowerCase() === TARGET_OWNER.toLowerCase()) {
        skipped++
        addLog(`⏭️ ${file.name} (already yours)`)
      } else {
        addLog(`🔄 ${file.name} (owner: ${ownerEmail})`)
        await transferOne(file.id, file.name)
      }

      // Recurse into subfolders
      if (isFolder) {
        await processFolder(file.id, `${path}/${file.name}`)
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100))
    }
  }

  // Transfer the root folder itself
  try {
    const rootMeta = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, owners',
      supportsAllDrives: true,
    })
    const rootOwner = rootMeta.data.owners?.[0]?.emailAddress || 'unknown'
    addLog(`📂 Root: ${rootMeta.data.name} (owner: ${rootOwner})`)

    if (rootOwner.toLowerCase() !== TARGET_OWNER.toLowerCase()) {
      total++
      await transferOne(folderId, rootMeta.data.name || 'Root folder')
    } else {
      addLog('⏭️ Root folder already owned by you')
    }
  } catch (err: any) {
    addLog(`⚠️ Could not check root folder: ${err.message}`)
  }

  // Process recursively
  await processFolder(folderId, 'Root')

  return {
    success: true,
    summary: { total, transferred, skipped, failed },
    log,
  }
})
