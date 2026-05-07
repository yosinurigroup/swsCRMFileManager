const FOLDER_MIME = 'application/vnd.google-apps.folder'

export default defineEventHandler(async (event) => {
  try {
    const { fileId, rootFolderId } = await readBody(event)
    if (!fileId || !rootFolderId) {
      throw createError({ statusCode: 400, statusMessage: 'fileId and rootFolderId are required' })
    }

    const drive = useDrive()

    // Find or create _Archive folder at root
    const existing = await drive.files.list({
      q: `'${rootFolderId}' in parents and name = '_Archive' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    let archiveFolderId: string
    if (existing.data.files && existing.data.files.length > 0) {
      archiveFolderId = existing.data.files[0]!.id!
    } else {
      const created = await drive.files.create({
        requestBody: {
          name: '_Archive',
          mimeType: FOLDER_MIME,
          parents: [rootFolderId],
        },
        fields: 'id',
        supportsAllDrives: true,
      })
      archiveFolderId = created.data.id!
    }

    // Get current parents so we can remove them
    const fileMeta = await drive.files.get({
      fileId,
      fields: 'parents, name',
      supportsAllDrives: true,
    })
    const oldParents = (fileMeta.data.parents || []).join(',')

    // Move file to _Archive folder
    await drive.files.update({
      fileId,
      addParents: archiveFolderId,
      removeParents: oldParents,
      fields: 'id, name',
      supportsAllDrives: true,
    })

    return { success: true, name: fileMeta.data.name }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to archive',
    })
  }
})
