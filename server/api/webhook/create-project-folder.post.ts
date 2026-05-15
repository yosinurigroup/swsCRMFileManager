/**
 * POST /api/webhook/create-project-folder
 *
 * Webhook to create a project folder inside a customer's Google Drive folder
 * and update the BigQuery Projects table with the new folder link.
 *
 * Accepts JSON, form-encoded, or query-string payloads (for AppSheet compatibility).
 *
 * Fields: customerFolder, folderName, projectId
 *
 * Returns: { success, folderId, folderUrl }
 */
export default defineEventHandler(async (event) => {
  // ── Parse payload from any format AppSheet might send ───────────────────
  const body = await readBody(event).catch(() => null)
  const query = getQuery(event)

  // Merge: body can be object, string (form-encoded parsed), or null
  const params = normalizeParams(body, query)

  console.log('[webhook:create-project-folder] Raw body:', JSON.stringify(body))
  console.log('[webhook:create-project-folder] Query:', JSON.stringify(query))
  console.log('[webhook:create-project-folder] Resolved params:', JSON.stringify(params))

  const customerFolder = params.customerFolder
  const folderName = params.folderName
  const projectId = params.projectId

  // ── Validate required fields ────────────────────────────────────────────
  if (!customerFolder) {
    throw createError({ statusCode: 400, statusMessage: 'customerFolder is required. Received params: ' + JSON.stringify(params) })
  }
  if (!folderName) {
    throw createError({ statusCode: 400, statusMessage: 'folderName is required. Received params: ' + JSON.stringify(params) })
  }
  if (!projectId) {
    throw createError({ statusCode: 400, statusMessage: 'projectId is required. Received params: ' + JSON.stringify(params) })
  }

  // ── Extract the folder ID from the Google Drive URL ─────────────────────
  const parentFolderId = extractFolderId(customerFolder)
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
        name: folderName,
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
        params: { folderUrl, pid: projectId },
      })

      console.log(`[webhook] Updated BigQuery Projects: Project ID = ${projectId}, Project Folder = ${folderUrl}`)
    } catch (bqErr: any) {
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize incoming params from various formats:
 *  - JSON body (object)
 *  - Form-encoded body (may come as string or parsed object)
 *  - Query string params
 */
function normalizeParams(body: any, query: any): Record<string, string> {
  const result: Record<string, string> = {}

  // If body is a string, try JSON parse, then try URL-encoded parse
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      // Try URL-encoded: key=value&key2=value2
      const parsed: Record<string, string> = {}
      for (const pair of body.split('&')) {
        const [k, ...v] = pair.split('=')
        if (k) parsed[decodeURIComponent(k.trim())] = decodeURIComponent(v.join('=').trim())
      }
      body = parsed
    }
  }

  // Merge body (higher priority) over query
  if (query && typeof query === 'object') Object.assign(result, query)
  if (body && typeof body === 'object') Object.assign(result, body)

  // Trim all string values
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') result[key] = result[key].trim()
  }

  return result
}

/**
 * Extract a Google Drive folder ID from various URL formats or raw ID.
 */
function extractFolderId(input: string): string | null {
  if (/^[\w-]{10,}$/.test(input)) return input
  const match = input.match(/\/folders\/([^/?&#]+)/)
  return match?.[1] || null
}
