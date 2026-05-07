export default defineEventHandler(async (event) => {
  try {
    const { fileId, name } = await readBody(event)
    if (!fileId || !name?.trim()) {
      throw createError({ statusCode: 400, statusMessage: 'fileId and name are required' })
    }

    const drive = useDrive()
    const res = await drive.files.update({
      fileId,
      requestBody: { name: name.trim() },
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    })

    return { success: true, file: res.data }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to rename',
    })
  }
})
