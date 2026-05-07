export default defineEventHandler(async (event) => {
  try {
    const { fileId } = getQuery(event) as { fileId: string }
    if (!fileId) throw createError({ statusCode: 400, statusMessage: 'fileId is required' })

    const drive = useDrive()

    // Get file metadata
    const meta = await drive.files.get({
      fileId,
      fields: 'name, mimeType, size',
      supportsAllDrives: true,
    })

    // Stream the file content
    const res = await drive.files.get({
      fileId,
      alt: 'media',
      supportsAllDrives: true,
    }, { responseType: 'stream' })

    const mimeType = meta.data.mimeType || 'application/octet-stream'

    // Set headers for inline streaming (no attachment — allows audio/video playback)
    setHeader(event, 'Content-Type', mimeType)
    setHeader(event, 'Content-Disposition', `inline; filename="${encodeURIComponent(meta.data.name || 'file')}"`)
    if (meta.data.size) {
      setHeader(event, 'Content-Length', Number(meta.data.size))
    }
    setHeader(event, 'Accept-Ranges', 'bytes')
    setHeader(event, 'Cache-Control', 'public, max-age=3600')

    return sendStream(event, res.data as any)
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || 'Failed to stream file',
    })
  }
})
