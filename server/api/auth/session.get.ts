export default defineEventHandler((event) => {
  const sessionCookie = getCookie(event, 'sws_session')

  // Dev-mode fallback: auto-authenticate when running locally with no cookie
  if (!sessionCookie && import.meta.dev) {
    return {
      authenticated: true,
      email: 'admin@y2kgrouphosting.com',
      name: 'Yosi Nuri',
      folderId: '1YWZPhAtQQQevUz0-hl7eDoYeEUjVYP6n',
      salesRep: 'John Smith',
      jobAddress: '5831 Yarwell Dr, Houston, TX 77096',
      customerName: 'TEST X TES X',
      phone: '(555) 123-4567',
      projectEmail: 'test@example.com',
      financeCompany: 'GoodLeap',
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
    jobAddress: session.jobAddress || '',
    customerName: session.customerName || '',
    phone: session.phone || '',
    projectEmail: session.projectEmail || '',
    financeCompany: session.financeCompany || '',
  }
})
