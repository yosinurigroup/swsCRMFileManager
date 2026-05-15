/**
 * Initiate a Google Drive resumable upload session.
 * Returns a resumable upload URI that the client can upload to directly.
 * 
 * The Origin header from the client request is forwarded to Google so that
 * the resumable session URI allows CORS from that origin.
 */
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { folderId, fileName, mimeType, fileSize } = body

    if (!folderId || !fileName) {
      throw createError({ statusCode: 400, statusMessage: 'folderId and fileName are required' })
    }

    // Get the OAuth2 client to make a raw API call
    const { drive: driveCfg } = useRuntimeConfig()
    const { google } = await import('googleapis')
    const oauth2Client = new google.auth.OAuth2(driveCfg.clientId, driveCfg.clientSecret)
    oauth2Client.setCredentials({ refresh_token: driveCfg.refreshToken })
    
    // Get a fresh access token
    const { token } = await oauth2Client.getAccessToken()
    if (!token) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to get access token' })
    }

    // Get the origin from the incoming request so Google Drive allows CORS
    const origin = getRequestHeader(event, 'origin') || getRequestHeader(event, 'referer')?.replace(/\/$/, '') || ''

    // Initiate a resumable upload session via Google Drive API
    const initUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true'
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    }
    
    // Forward the origin so Google's CORS allows the client to upload directly
    if (origin) {
      headers['Origin'] = origin
    }
    if (fileSize) {
      headers['X-Upload-Content-Length'] = String(fileSize)
    }
    if (mimeType) {
      headers['X-Upload-Content-Type'] = mimeType
    }

    const initRes = await fetch(initUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    })

    if (!initRes.ok) {
      const errText = await initRes.text()
      console.error('Google Drive resumable init error:', errText)
      throw createError({ statusCode: initRes.status, statusMessage: `Google Drive error: ${errText}` })
    }

    // The Location header contains the resumable upload URI
    const uploadUri = initRes.headers.get('Location')
    if (!uploadUri) {
      throw createError({ statusCode: 500, statusMessage: 'No upload URI returned from Google Drive' })
    }

    return {
      success: true,
      uploadUri,
      accessToken: token,
    }
  } catch (err: any) {
    console.error('Resumable upload init error:', err.message || err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to initiate upload',
    })
  }
})
