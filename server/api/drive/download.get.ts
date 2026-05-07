export default defineEventHandler(async (event) => {
  try {
    const { fileId } = getQuery(event) as { fileId: string }
    if (!fileId) throw createError({ statusCode: 400, statusMessage: 'fileId is required' })

    const drive = useDrive()

    // Get file metadata for the name
    const meta = await drive.files.get({
      fileId,
      fields: 'name, mimeType',
      supportsAllDrives: true,
    })

    // Download the file content
    const res = await drive.files.get({
      fileId,
      alt: 'media',
      supportsAllDrives: true,
    }, { responseType: 'stream' })

    // Set headers
    setHeader(event, 'Content-Type', meta.data.mimeType || 'application/octet-stream')
    setHeader(event, 'Content-Disposition', `attachment; filename="${encodeURIComponent(meta.data.name || 'download')}"`)

    return sendStream(event, res.data as any)
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || 'Failed to download file',
    })
  }
})
