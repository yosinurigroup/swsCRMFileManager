import { Readable } from 'node:stream'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export default defineEventHandler(async (event) => {
  try {
    const formData = await readMultipartFormData(event)
    if (!formData || formData.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'No file provided' })
    }

    const folderIdField = formData.find(f => f.name === 'folderId')
    const folderId = folderIdField?.data?.toString()
    if (!folderId) {
      throw createError({ statusCode: 400, statusMessage: 'folderId is required' })
    }

    const drive = useDrive()

    // Cache of created folders: relative path → Drive folder ID
    const folderCache: Record<string, string> = { '': folderId }

    // Ensure a folder path exists in Drive, creating parent folders as needed
    async function ensureFolder(relativePath: string): Promise<string> {
      if (folderCache[relativePath]) return folderCache[relativePath]!

      const parts = relativePath.split('/')
      let builtPath = ''
      for (const part of parts) {
        const parentPath = builtPath
        builtPath = builtPath ? `${builtPath}/${part}` : part
        if (!folderCache[builtPath]) {
          const parentId = folderCache[parentPath]!
          const res = await drive.files.create({
            requestBody: { name: part, mimeType: FOLDER_MIME, parents: [parentId] },
            fields: 'id',
            supportsAllDrives: true,
          })
          folderCache[builtPath] = res.data.id!
        }
      }
      return folderCache[relativePath]!
    }

    const fileFields = formData.filter(f => f.name === 'files' && f.filename)
    // relativePaths is sent as a JSON array matching the order of files
    const relativePathsField = formData.find(f => f.name === 'relativePaths')
    const relativePaths: string[] = relativePathsField
      ? JSON.parse(relativePathsField.data.toString())
      : fileFields.map(() => '')

    const uploaded: { id: string, name: string, mimeType: string }[] = []

    for (let i = 0; i < fileFields.length; i++) {
      const file = fileFields[i]!
      const relPath = relativePaths[i] || ''

      // Determine parent folder: strip the file name from the path
      const parts = relPath.split('/')
      const folderParts = parts.slice(0, -1)
      const targetFolderId = folderParts.length > 0
        ? await ensureFolder(folderParts.join('/'))
        : folderId

      const stream = new Readable()
      stream.push(file.data)
      stream.push(null)

      const fileName = file.filename || parts[parts.length - 1] || 'Untitled'
      const mimeType = file.type || 'application/octet-stream'
      const fileSize = file.data.length

      // Use resumable upload for files > 5MB for reliability
      const useResumable = fileSize > 5 * 1024 * 1024

      const res = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [targetFolderId],
        },
        media: {
          mimeType,
          body: stream,
        },
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      }, {
        // Use resumable upload for large files
        ...(useResumable ? {
          // Signal to googleapis to use resumable upload
          onUploadProgress: () => {},
        } : {}),
      })

      if (res.data.id) {
        uploaded.push({
          id: res.data.id,
          name: res.data.name || fileName,
          mimeType: res.data.mimeType || mimeType,
        })
      }
    }

    return { success: true, uploaded, count: uploaded.length }
  }
  catch (err: any) {
    console.error('Upload error:', err.message || err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to upload files',
    })
  }
})
