const FOLDER_MIME = 'application/vnd.google-apps.folder'

export default defineEventHandler(async (event) => {
  try {
    const { fileId, rootFolderId } = await readBody(event)
    if (!fileId) {
      throw createError({ statusCode: 400, statusMessage: 'fileId is required' })
    }

    const drive = useDrive()

    // Get the original file metadata
    const meta = await drive.files.get({
      fileId,
      fields: 'name, parents',
      supportsAllDrives: true,
    })

    // Find or create "Converted Files" folder inside the root folder
    const parentForConverted = rootFolderId || (meta.data.parents?.[0])
    let convertedFolderId: string | undefined

    if (parentForConverted) {
      // Search for existing "Converted Files" folder
      const search = await drive.files.list({
        q: `name = 'Converted Files' and '${parentForConverted}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: 'files(id, name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })

      if (search.data.files && search.data.files.length > 0) {
        convertedFolderId = search.data.files[0]!.id!
      } else {
        // Create "Converted Files" folder
        const folder = await drive.files.create({
          requestBody: {
            name: 'Converted Files',
            mimeType: FOLDER_MIME,
            parents: [parentForConverted],
          },
          fields: 'id',
          supportsAllDrives: true,
        })
        convertedFolderId = folder.data.id!
      }
    }

    // Copy the file and convert it to native Google Sheets format
    // Place in "Converted Files" folder instead of the original folder
    const res = await drive.files.copy({
      fileId,
      requestBody: {
        name: meta.data.name?.replace(/\.(csv|xlsx?)$/i, '') || meta.data.name,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: convertedFolderId ? [convertedFolderId] : (meta.data.parents || undefined),
      },
      fields: 'id, name, mimeType, webViewLink',
      supportsAllDrives: true,
    })

    const sheetUrl = res.data.webViewLink
      || `https://docs.google.com/spreadsheets/d/${res.data.id}/edit`

    return { success: true, url: sheetUrl, fileId: res.data.id }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to open as Google Sheet',
    })
  }
})
