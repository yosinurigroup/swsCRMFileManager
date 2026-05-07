export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const path = url.pathname

  // Only protect /files/* routes and /api/drive/* routes
  const isProtectedPage = path.startsWith('/files/')
  const isProtectedApi = path.startsWith('/api/drive/')

  // Skip auth routes
  if (path.startsWith('/api/auth/')) return

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

  // Verify the folder being accessed matches the session
  if (isProtectedPage) {
    const requestedFolder = path.replace('/files/', '').split('/')[0]
    if (requestedFolder && session.folderId && requestedFolder !== session.folderId) {
      if (isProtectedApi) {
        throw createError({ statusCode: 403, statusMessage: 'Access denied to this folder' })
      }
      return sendRedirect(event, '/unauthorized')
    }
  }

  // Attach session to event context for downstream use
  event.context.session = session
})
