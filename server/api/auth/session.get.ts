export default defineEventHandler((event) => {
  const sessionCookie = getCookie(event, 'sws_session')
  if (!sessionCookie) return { authenticated: false }

  const session = decryptSession(sessionCookie)
  if (!session || !session.exp || session.exp < Date.now()) {
    return { authenticated: false }
  }

  return {
    authenticated: true,
    email: session.email,
    name: session.name,
    folderId: session.folderId,
  }
})
