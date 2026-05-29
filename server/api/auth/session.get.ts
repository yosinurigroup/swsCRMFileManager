export default defineEventHandler((event) => {
  const sessionCookie = getCookie(event, 'sws_session')

  // Dev-mode fallback: auto-authenticate when running locally with no cookie
  if (!sessionCookie && import.meta.dev) {
    return {
      authenticated: true,
      email: 'admin@y2kgrouphosting.com',
      name: 'Yosi Nuri',
      folderId: '1YWZPhAtQQQevUz0-hl7eDoYeEUjVYP6n',
      salesRep: '',
    }
  }

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
    salesRep: session.salesRep || '',
  }
})
