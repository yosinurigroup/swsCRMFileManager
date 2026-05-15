/**
 * POST /api/drive/create-gdoc
 * body: { parentId: string, name: string, type: 'sheet' | 'doc' | 'slides' }
 *
 * Creates a new Google Workspace file inside the given Drive folder.
 */
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { parentId, name, type } = body as { parentId: string; name: string; type: string }

    if (!parentId) throw createError({ statusCode: 400, statusMessage: 'parentId is required' })
    if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: 'name is required' })

    const mimeMap: Record<string, string> = {
      sheet:  'application/vnd.google-apps.spreadsheet',
      doc:    'application/vnd.google-apps.document',
      slides: 'application/vnd.google-apps.presentation',
    }
    const mimeType = mimeMap[type]
    if (!mimeType) throw createError({ statusCode: 400, statusMessage: 'Invalid type. Use: sheet | doc | slides' })

    const drive = useDrive()

    const res = await drive.files.create({
      requestBody: {
        name: name.trim(),
        mimeType,
        parents: [parentId],
      },
      fields: 'id, name, mimeType, modifiedTime, webViewLink',
      supportsAllDrives: true,
    })

    return {
      success: true,
      file: res.data,
      webViewLink: res.data.webViewLink,
    }
  } catch (err: any) {
    console.error('create-gdoc error:', err)
    throw createError({ statusCode: err.statusCode || 500, statusMessage: err.message || 'Failed to create file' })
  }
})
