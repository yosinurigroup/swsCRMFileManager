export default defineEventHandler(async (event) => {
  try {
    const { folderId } = getQuery(event) as { folderId: string }
    if (!folderId) throw createError({ statusCode: 400, statusMessage: 'folderId is required' })

    const drive = useDrive()

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size, modifiedTime, thumbnailLink, iconLink, webViewLink, webContentLink)',
      orderBy: 'folder,name',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    // Get folder name
    const folderMeta = await drive.files.get({
      fileId: folderId,
      fields: 'name',
      supportsAllDrives: true,
    })

    return {
      success: true,
      files: res.data.files || [],
      folderName: folderMeta.data.name || '',
    }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || 'Failed to list Drive files',
    })
  }
})
