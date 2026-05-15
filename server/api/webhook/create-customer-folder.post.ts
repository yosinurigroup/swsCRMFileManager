/**
 * POST /api/webhook/create-customer-folder
 *
 * Webhook to create a customer folder inside the static parent Drive folder
 * and update the BigQuery Customers table with the new folder link.
 *
 * Body: {
 *   folderName: string   — Name of the new customer folder to create
 *   customerId: string   — Customer ID to match in BigQuery
 * }
 *
 * Returns: { success, folderId, folderUrl }
 */

const PARENT_FOLDER_ID = '1RkGnGqSF6hSb-Main58ErEYZCU5Q1FFx'

export default defineEventHandler(async (event) => {
  const { folderName, customerId } = await readBody(event)

  // ── Validate required fields ────────────────────────────────────────────
  if (!folderName?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'folderName is required' })
  }
  if (!customerId?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'customerId is required' })
  }

  try {
    const drive = useDrive()

    // ── 1. Create the customer folder inside the static parent folder ─────
    const createRes = await drive.files.create({
      requestBody: {
        name: folderName.trim(),
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
        params: { folderUrl, cid: customerId.trim() },
      })

      console.log(`[webhook] Updated BigQuery Customers: Customer ID = ${customerId}, Customer Files = ${folderUrl}`)
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
      statusMessage: err.message || 'Failed to create customer folder',
    })
  }
})
