/**
 * POST /api/webhook/create-project-folder
 *
 * Webhook to create a project folder inside a customer's Google Drive folder
 * and update the BigQuery Projects table with the new folder link.
 *
 * Body: {
 *   customerFolder: string  — Google Drive URL of the parent customer folder
 *   folderName: string      — Name of the new project folder to create
 *   projectId: string       — Project ID to match in BigQuery
 * }
 *
 * Returns: { success, folderId, folderUrl }
 */
export default defineEventHandler(async (event) => {
  const { customerFolder, folderName, projectId } = await readBody(event)

  // ── Validate required fields ────────────────────────────────────────────
  if (!customerFolder?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'customerFolder is required' })
  }
  if (!folderName?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'folderName is required' })
  }
  if (!projectId?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'projectId is required' })
  }

  // ── Extract the folder ID from the Google Drive URL ─────────────────────
  const parentFolderId = extractFolderId(customerFolder.trim())
  if (!parentFolderId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Could not extract folder ID from customerFolder URL. Expected a Google Drive folder URL.',
    })
  }

  try {
    const drive = useDrive()

    // ── 1. Create the project folder inside the customer folder ───────────
    const createRes = await drive.files.create({
      requestBody: {
        name: folderName.trim(),
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true,
    })

    const newFolderId = createRes.data.id!
    const folderUrl = createRes.data.webViewLink || `https://drive.google.com/drive/folders/${newFolderId}`

    console.log(`[webhook] Created folder "${folderName}" (${newFolderId}) inside ${parentFolderId}`)

    // ── 2. Update BigQuery Projects table ─────────────────────────────────
    try {
      const bq = useBigQuery()
      const dataset = getDataset()

      await bq.query({
        query: `UPDATE \`${dataset}.Projects\` SET \`Project Folder\` = @folderUrl WHERE \`Project ID\` = @pid`,
        params: { folderUrl, pid: projectId.trim() },
      })

      console.log(`[webhook] Updated BigQuery Projects: Project ID = ${projectId}, Project Folder = ${folderUrl}`)
    } catch (bqErr: any) {
      // Log BQ error but still return success for the folder creation
      console.error('[webhook] BigQuery update error:', bqErr.message)
      return {
        success: true,
        warning: 'Folder created but BigQuery update failed: ' + bqErr.message,
        folderId: newFolderId,
        folderUrl,
      }
    }

    return {
      success: true,
      folderId: newFolderId,
      folderUrl,
    }
  } catch (err: any) {
    console.error('[webhook] Error:', err.message)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || 'Failed to create project folder',
    })
  }
})

/**
 * Extract a Google Drive folder ID from various URL formats:
 *  - https://drive.google.com/drive/folders/FOLDER_ID
 *  - https://drive.google.com/drive/folders/FOLDER_ID?...
 *  - https://drive.google.com/drive/u/0/folders/FOLDER_ID
 *  - Raw folder ID (no URL)
 */
function extractFolderId(input: string): string | null {
  // If it looks like a raw folder ID (no slashes, no dots), return as-is
  if (/^[\w-]{10,}$/.test(input)) return input

  // Try to match the folder ID from URL patterns
  const match = input.match(/\/folders\/([^/?&#]+)/)
  return match?.[1] || null
}
