export default defineEventHandler(async (event) => {
  try {
    const { fileId } = await readBody(event)
    if (!fileId) {
      throw createError({ statusCode: 400, statusMessage: 'fileId is required' })
    }

    const drive = useDrive()

    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    })

    return { success: true }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to delete file',
    })
  }
})
