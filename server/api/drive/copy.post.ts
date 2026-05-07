export default defineEventHandler(async (event) => {
  try {
    const { fileId } = await readBody(event)
    if (!fileId) {
      throw createError({ statusCode: 400, statusMessage: 'fileId is required' })
    }

    const drive = useDrive()

    // Copy with "(Copy)" suffix
    const meta = await drive.files.get({
      fileId,
      fields: 'name, parents',
      supportsAllDrives: true,
    })

    const res = await drive.files.copy({
      fileId,
      requestBody: {
        name: `${meta.data.name} (Copy)`,
        parents: meta.data.parents || undefined,
      },
      fields: 'id, name, mimeType, size, modifiedTime',
      supportsAllDrives: true,
    })

    return { success: true, file: res.data }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to copy file',
    })
  }
})
