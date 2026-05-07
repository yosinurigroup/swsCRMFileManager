import { google } from 'googleapis'
import type { drive_v3 } from 'googleapis'

/**
 * Returns a Google Drive v3 client using OAuth2 credentials.
 */
export function useDrive(): drive_v3.Drive {
  const { drive } = useRuntimeConfig()

  if (!drive.clientId || !drive.clientSecret || !drive.refreshToken) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Google Drive credentials not configured. Set NUXT_DRIVE_CLIENT_ID, NUXT_DRIVE_CLIENT_SECRET, and NUXT_DRIVE_REFRESH_TOKEN in .env',
    })
  }

  const oauth2Client = new google.auth.OAuth2(drive.clientId, drive.clientSecret)
  oauth2Client.setCredentials({ refresh_token: drive.refreshToken })
  return google.drive({ version: 'v3', auth: oauth2Client })
}
