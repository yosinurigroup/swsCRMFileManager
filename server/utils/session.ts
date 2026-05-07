import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getSecret(): Buffer {
  const secret = useRuntimeConfig().auth?.secret || 'sws-default-secret-change-in-production!'
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptSession(data: Record<string, any>): string {
  const key = getSecret()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted}`
}

export function decryptSession(token: string): Record<string, any> | null {
  try {
    const key = getSecret()
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [ivHex, tagHex, encrypted] = parts
    const iv = Buffer.from(ivHex!, 'hex')
    const tag = Buffer.from(tagHex!, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    let decrypted = decipher.update(encrypted!, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return JSON.parse(decrypted)
  } catch {
    return null
  }
}
