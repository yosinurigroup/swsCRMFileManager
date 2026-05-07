export default defineEventHandler(async (event) => {
  try {
    const { parentId, name } = await readBody(event)
    if (!parentId || !name?.trim()) {
      throw createError({ statusCode: 400, statusMessage: 'parentId and name are required' })
    }

    const drive = useDrive()
    const res = await drive.files.create({
      requestBody: {
        name: name.trim(),
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    })

    return { success: true, folder: res.data }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to create folder',
    })
  }
})
