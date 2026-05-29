export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const path = url.pathname

  // Protected routes
  const isFilePage = path.startsWith('/files/')
  const isReportPage = path.startsWith('/report/')
  const isProtectedPage = isFilePage || isReportPage
  const isProtectedApi = path.startsWith('/api/drive/') || path.startsWith('/api/bq/')

  // Skip auth routes, transfer admin tool, and webhook endpoints
  if (path.startsWith('/api/auth/') || path.startsWith('/api/transfer/') || path.startsWith('/api/webhook/') || path === '/transfer') return

  // Dev-mode: skip auth checks so reports work on localhost without login
  if (import.meta.dev) return

  if (!isProtectedPage && !isProtectedApi) return

  const sessionCookie = getCookie(event, 'sws_session')

  if (!sessionCookie) {
    if (isProtectedApi) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    return sendRedirect(event, '/unauthorized')
  }

  const session = decryptSession(sessionCookie)

  if (!session || !session.exp || session.exp < Date.now()) {
    // Session expired — clear cookie
    deleteCookie(event, 'sws_session', { path: '/' })
    if (isProtectedApi) {
      throw createError({ statusCode: 401, statusMessage: 'Session expired' })
    }
    return sendRedirect(event, '/unauthorized')
  }

  // Verify browser fingerprint — prevents cross-browser reuse
  const fpCookie = getCookie(event, 'sws_fp')
  if (session.fp && fpCookie !== session.fp) {
    deleteCookie(event, 'sws_session', { path: '/' })
    deleteCookie(event, 'sws_fp', { path: '/' })
    if (isProtectedApi) {
      throw createError({ statusCode: 401, statusMessage: 'Session invalid for this browser' })
    }
    return sendRedirect(event, '/unauthorized')
  }

  // Verify folder access for file pages
  if (isFilePage) {
    const requestedFolder = path.replace('/files/', '').split('/')[0]
    if (requestedFolder && session.folderId && requestedFolder !== session.folderId) {
      return sendRedirect(event, '/unauthorized')
    }
  }

  // Attach session to event context for downstream use
  event.context.session = session
})
