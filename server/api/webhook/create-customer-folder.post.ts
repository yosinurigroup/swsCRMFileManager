/**
 * POST /api/webhook/create-customer-folder
 *
 * Webhook to create a customer folder inside the static parent Drive folder
 * and update the BigQuery Customers table with the new folder link.
 *
 * Accepts JSON, form-encoded, or query-string payloads (for AppSheet compatibility).
 *
 * Fields: folderName, customerId
 *
 * Returns: { success, folderId, folderUrl }
 */

const PARENT_FOLDER_ID = '1RkGnGqSF6hSb-Main58ErEYZCU5Q1FFx'

export default defineEventHandler(async (event) => {
  // ── Parse payload from any format AppSheet might send ───────────────────
  const body = await readBody(event).catch(() => null)
  const query = getQuery(event)

  // Merge: body can be object, string (form-encoded parsed), or null
  const params = normalizeParams(body, query)

  console.log('[webhook:create-customer-folder] Raw body:', JSON.stringify(body))
  console.log('[webhook:create-customer-folder] Query:', JSON.stringify(query))
  console.log('[webhook:create-customer-folder] Resolved params:', JSON.stringify(params))

  const folderName = params.folderName
  const customerId = params.customerId

  // ── Validate required fields ────────────────────────────────────────────
  if (!folderName) {
    throw createError({ statusCode: 400, statusMessage: 'folderName is required. Received params: ' + JSON.stringify(params) })
  }
  if (!customerId) {
    throw createError({ statusCode: 400, statusMessage: 'customerId is required. Received params: ' + JSON.stringify(params) })
  }

  try {
    const drive = useDrive()

    // ── 1. Create the customer folder inside the static parent folder ─────
    const createRes = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [PARENT_FOLDER_ID],
      },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true,
    })

    const newFolderId = createRes.data.id!
    const folderUrl = createRes.data.webViewLink || `https://drive.google.com/drive/folders/${newFolderId}`

    console.log(`[webhook] Created customer folder "${folderName}" (${newFolderId}) inside ${PARENT_FOLDER_ID}`)

    // ── 2. Update BigQuery Customers table ────────────────────────────────
    try {
      const bq = useBigQuery()
      const dataset = getDataset()

      await bq.query({
        query: `UPDATE \`${dataset}.Customers\` SET \`Customer Files\` = @folderUrl WHERE \`Customer ID\` = @cid`,
        params: { folderUrl, cid: customerId },
      })

      console.log(`[webhook] Updated BigQuery Customers: Customer ID = ${customerId}, Customer Files = ${folderUrl}`)
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
      statusMessage: err.message || 'Failed to create customer folder',
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
