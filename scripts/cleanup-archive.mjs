/**
 * Cleanup _archivedOriginals
 * ──────────────────────────
 * Removes admin-owned duplicate folders from _archivedOriginals
 * (these are the mirror structure folders that shouldn't be there)
 *
 * Usage: node scripts/cleanup-archive.mjs ARCHIVE_FOLDER_ID
 */

import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env')
const envContent = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx)
  let val = trimmed.slice(eqIdx + 1)
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
  env[key] = val
}

const TARGET_OWNER = 'admin@y2kgrouphosting.com'
const oauth2Client = new google.auth.OAuth2(env.NUXT_DRIVE_CLIENT_ID, env.NUXT_DRIVE_CLIENT_SECRET)
oauth2Client.setCredentials({ refresh_token: env.NUXT_DRIVE_REFRESH_TOKEN })
const drive = google.drive({ version: 'v3', auth: oauth2Client })

const archiveId = process.argv[2]
if (!archiveId) { console.log('Usage: node scripts/cleanup-archive.mjs ARCHIVE_FOLDER_ID'); process.exit(1) }

console.log('🧹 Cleaning up admin-owned duplicates from _archivedOriginals...\n')

const res = await drive.files.list({
  q: `'${archiveId}' in parents and trashed = false`,
  fields: 'files(id, name, mimeType, owners)',
  pageSize: 1000,
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
})

let deleted = 0
for (const file of (res.data.files || [])) {
  const owner = (file.owners && file.owners[0] && file.owners[0].emailAddress) || 'unknown'
  if (owner.toLowerCase() === TARGET_OWNER.toLowerCase()) {
    console.log(`  🗑️  Deleting admin-owned: ${file.name}`)
    try {
      await drive.files.delete({ fileId: file.id, supportsAllDrives: true })
      deleted++
    } catch (err) {
      console.log(`  ❌ Failed to delete: ${file.name} — ${err.message}`)
    }
  } else {
    console.log(`  ✅ Keeping original: ${file.name} (owner: ${owner})`)
  }
}

console.log(`\n🧹 Cleaned up ${deleted} duplicate folders`)
