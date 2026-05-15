const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const CONVERTED_FOLDER_NAME = '_ConvertedFiles'

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

    const originalParent = meta.data.parents?.[0]
    const sheetName = meta.data.name?.replace(/\.(csv|xlsx?)$/i, '') || meta.data.name || 'Untitled'

    // ── Check if a Google Sheet with the same name already exists ──
    if (originalParent) {
      const existing = await drive.files.list({
        q: `name = '${sheetName.replace(/'/g, "\\'")}' and '${originalParent}' in parents and mimeType = '${SHEET_MIME}' and trashed = false`,
        fields: 'files(id, webViewLink)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 1,
      })

      if (existing.data.files && existing.data.files.length > 0) {
        // Already converted — just open the existing sheet
        const f = existing.data.files[0]!
        const url = f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`
        return { success: true, url, fileId: f.id }
      }
    }

    // ── No existing sheet found — convert now ──

    // 1. Create the Google Sheet in the SAME folder as the original CSV
    const res = await drive.files.copy({
      fileId,
      requestBody: {
        name: sheetName,
        mimeType: SHEET_MIME,
        parents: originalParent ? [originalParent] : undefined,
      },
      fields: 'id, name, mimeType, webViewLink',
      supportsAllDrives: true,
    })

    // 2. Find or create _ConvertedFiles folder inside the ROOT folder
    const convertedParent = rootFolderId || originalParent
    if (convertedParent) {
      let convertedFolderId: string | undefined

      const search = await drive.files.list({
        q: `name = '${CONVERTED_FOLDER_NAME}' and '${convertedParent}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 1,
      })

      if (search.data.files && search.data.files.length > 0) {
        convertedFolderId = search.data.files[0]!.id!
      } else {
        const folder = await drive.files.create({
          requestBody: {
            name: CONVERTED_FOLDER_NAME,
            mimeType: FOLDER_MIME,
            parents: [convertedParent],
          },
          fields: 'id',
          supportsAllDrives: true,
        })
        convertedFolderId = folder.data.id!
      }

      // 3. Move the original CSV into _ConvertedFiles
      if (convertedFolderId) {
        await drive.files.update({
          fileId,
          addParents: convertedFolderId,
          removeParents: originalParent || undefined,
          supportsAllDrives: true,
        })
      }
    }

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
