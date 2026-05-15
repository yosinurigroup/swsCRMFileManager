export default defineEventHandler(async (event) => {
  try {
    const { fileId } = await readBody(event)
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

    // Copy the file and convert it to native Google Sheets format
    const res = await drive.files.copy({
      fileId,
      requestBody: {
        name: meta.data.name?.replace(/\.(csv|xlsx?)$/i, '') || meta.data.name,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: meta.data.parents || undefined,
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
