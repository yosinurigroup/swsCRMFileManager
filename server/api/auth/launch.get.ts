export default defineEventHandler(async (event) => {
  const query = getQuery(event) as {
    folder?: string
    email?: string
    name?: string
    key?: string
  }

  const config = useRuntimeConfig()
  const apiKey = config.auth?.apiKey

  // Validate API key
  if (!apiKey || !query.key || query.key !== apiKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: Invalid or missing API key' })
  }

  // Validate required params
  if (!query.folder || !query.email) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required parameters: folder, email' })
  }

  // Extract folder ID from URL or use as-is
  let folderId = query.folder
  const match = folderId.match(/[-\w]{25,}/)
  if (match) folderId = match[0]

  // Create encrypted session (8-hour expiry)
  const sessionData = {
    folderId,
    email: query.email,
    name: query.name || 'User',
    exp: Date.now() + 8 * 60 * 60 * 1000,
    iat: Date.now(),
    nonce: Math.random().toString(36).slice(2),
  }

  const encrypted = encryptSession(sessionData)

  // Set httpOnly secure cookie
  setCookie(event, 'sws_session', encrypted, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60,
    path: '/',
  })

  // Redirect to file manager
  return sendRedirect(event, `/files/${folderId}`)
})
