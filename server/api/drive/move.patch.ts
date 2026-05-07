export default defineEventHandler(async (event) => {
  try {
    const { fileId, newParentId, oldParentId } = await readBody(event)
    if (!fileId || !newParentId || !oldParentId) {
      throw createError({ statusCode: 400, statusMessage: 'fileId, newParentId and oldParentId are required' })
    }

    const drive = useDrive()

    const res = await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: oldParentId,
      fields: 'id, name, mimeType, parents',
      supportsAllDrives: true,
    })

    return { success: true, file: res.data }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to move file',
    })
  }
})
