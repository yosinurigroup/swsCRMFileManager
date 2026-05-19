export default defineEventHandler(async (event) => {
  try {
    const { templateFileId, name, parentId } = await readBody(event)
    if (!templateFileId || !parentId) {
      throw createError({ statusCode: 400, statusMessage: 'templateFileId and parentId are required' })
    }

    const drive = useDrive()

    // Copy the template file into the target folder
    const res = await drive.files.copy({
      fileId: templateFileId,
      requestBody: {
        name: name || 'GPN SOW TEMPLATE',
        parents: [parentId],
      },
      fields: 'id, name, mimeType, size, modifiedTime, webViewLink',
      supportsAllDrives: true,
    })

    const newFileId = res.data.id!

    // Set sharing: "Anyone with the link" can view
    await drive.permissions.create({
      fileId: newFileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
      supportsAllDrives: true,
    })

    return { success: true, file: res.data }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to copy template',
    })
  }
})
