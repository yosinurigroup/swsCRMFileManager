export default defineEventHandler(async (event) => {
  const query = getQuery(event) as {
    folder?: string
    email?: string
    name?: string
    key?: string
    redirect?: string
    salesRep?: string
    // GPN SOW fields
    jobAddress?: string
    customerName?: string
    phone?: string
    projectEmail?: string
    financeCompany?: string
  }

  const config = useRuntimeConfig()
  const apiKey = config.auth?.apiKey

  // Validate API key
  if (!apiKey || !query.key || query.key !== apiKey) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: Invalid or missing API key' })
  }

  // Validate required params
  if (!query.email) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required parameter: email' })
  }

  // Extract folder ID from URL or use as-is (optional for report pages)
  let folderId = ''
  if (query.folder) {
    folderId = query.folder
    const match = folderId.match(/[-\w]{25,}/)
    if (match) folderId = match[0]
  }

  // Create encrypted session (8-hour expiry)
  const sessionData: Record<string, any> = {
    folderId,
    email: query.email,
    name: query.name || 'User',
    salesRep: query.salesRep || '',
    // GPN SOW project fields
    jobAddress: query.jobAddress || '',
    customerName: query.customerName || '',
    phone: query.phone || '',
    projectEmail: query.projectEmail || '',
    financeCompany: query.financeCompany || '',
    exp: Date.now() + 8 * 60 * 60 * 1000,
    iat: Date.now(),
    nonce: Math.random().toString(36).slice(2),
  }

  // Browser fingerprint — binds session to this specific browser
  const fingerprint = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  sessionData.fp = fingerprint

  const encrypted = encryptSession(sessionData)

  // Set httpOnly secure session cookie
  setCookie(event, 'sws_session', encrypted, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60,
    path: '/',
  })

  // Set matching fingerprint cookie (also httpOnly)
  setCookie(event, 'sws_fp', fingerprint, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60,
    path: '/',
  })

  // Determine redirect target
  if (query.redirect === 'pm-weekly') {
    return sendRedirect(event, '/report/pm-weekly')
  }
  if (query.redirect === 'general-report') {
    return sendRedirect(event, '/report/general-report')
  }

  // Default: redirect to file manager
  if (folderId) {
    return sendRedirect(event, `/files/${folderId}`)
  }

  return sendRedirect(event, '/unauthorized')
})
