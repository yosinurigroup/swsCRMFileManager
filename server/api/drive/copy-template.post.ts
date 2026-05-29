import { google } from 'googleapis'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { templateFileId, name, parentId, fillData } = body as {
      templateFileId: string
      name?: string
      parentId: string
      fillData?: {
        jobAddress?: string
        customerName?: string
        phone?: string
        email?: string
        salesRep?: string
        financeCompany?: string
      }
    }

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

    // Fill cells with project data if provided
    if (fillData && Object.values(fillData).some(v => v)) {
      try {
        // Get the same OAuth2 client used by Drive
        const { drive: driveConfig } = useRuntimeConfig()
        const oauth2Client = new google.auth.OAuth2(driveConfig.clientId, driveConfig.clientSecret)
        oauth2Client.setCredentials({ refresh_token: driveConfig.refreshToken })
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client })

        // Map field values to cells C3:C8 (matching the template layout)
        const values = [
          [fillData.jobAddress || ''],       // C3: JOB SITE ADDRESS
          [fillData.customerName || ''],     // C4: HOMEOWNER NAME
          [fillData.phone || ''],            // C5: PHONE NUMBER
          [fillData.email || ''],            // C6: EMAIL ADDRESS
          [fillData.salesRep || ''],         // C7: REPRESENTATIVE
          [fillData.financeCompany || ''],   // C8: FINANCING
        ]

        await sheets.spreadsheets.values.update({
          spreadsheetId: newFileId,
          range: 'Sheet1!C3:C8',
          valueInputOption: 'RAW',
          requestBody: { values },
        })
      } catch (fillErr: any) {
        // Don't fail the whole operation if cell-fill fails — the sheet was already created
        console.warn('GPN SOW cell fill warning:', fillErr.message)
      }
    }

    return { success: true, file: res.data }
  }
  catch (err: any) {
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to copy template',
    })
  }
})
