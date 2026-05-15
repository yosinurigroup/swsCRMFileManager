/**
 * Transfer Ownership Script
 * ─────────────────────────
 * Recursively transfers ownership of ALL files & folders
 * in a Google Drive folder to admin@y2kgrouphosting.com
 *
 * Usage:  node scripts/transfer-ownership.mjs FOLDER_ID
 */

import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── Load .env manually ────────────────────────────────────────────────────
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
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  env[key] = val
}

const TARGET_OWNER = 'admin@y2kgrouphosting.com'

// ── Verify credentials ────────────────────────────────────────────────────
console.log('🔍 Checking credentials...')
console.log(`   Client ID: ${env.NUXT_DRIVE_CLIENT_ID ? '✅ found' : '❌ MISSING'}`)
console.log(`   Client Secret: ${env.NUXT_DRIVE_CLIENT_SECRET ? '✅ found' : '❌ MISSING'}`)
console.log(`   Refresh Token: ${env.NUXT_DRIVE_REFRESH_TOKEN ? '✅ found (' + env.NUXT_DRIVE_REFRESH_TOKEN.length + ' chars)' : '❌ MISSING'}`)
console.log('')

// ── Auth ───────────────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  env.NUXT_DRIVE_CLIENT_ID,
  env.NUXT_DRIVE_CLIENT_SECRET,
)
oauth2Client.setCredentials({ refresh_token: env.NUXT_DRIVE_REFRESH_TOKEN })
const drive = google.drive({ version: 'v3', auth: oauth2Client })

// ── Counters ───────────────────────────────────────────────────────────────
let transferred = 0
let skipped = 0
let failed = 0
let total = 0

// ── List all files in a folder ─────────────────────────────────────────────
async function listAllFiles(folderId) {
  const files = []
  let pageToken

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, owners)',
      orderBy: 'folder,name',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    })
    if (res.data.files) files.push(...res.data.files)
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)

  return files
}

// ── Transfer ownership of a single file ────────────────────────────────────
async function transferOwnership(fileId, fileName) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'owner',
        type: 'user',
        emailAddress: TARGET_OWNER,
      },
      transferOwnership: true,
      supportsAllDrives: true,
    })
    transferred++
    console.log(`  ✅ Transferred: ${fileName}`)
  } catch (err) {
    const msg = err.message || (err.errors && err.errors[0] && err.errors[0].message) || 'Unknown error'
    failed++
    console.log(`  ❌ Failed: ${fileName} — ${msg}`)
  }
}

// ── Recursively process a folder ───────────────────────────────────────────
async function processFolder(folderId, depth = 0) {
  const indent = '  '.repeat(depth)
  const files = await listAllFiles(folderId)

  console.log(`${indent}📂 Found ${files.length} items`)

  for (const file of files) {
    total++
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
    const ownerEmail = (file.owners && file.owners[0] && file.owners[0].emailAddress) || 'unknown'

    if (ownerEmail.toLowerCase() === TARGET_OWNER.toLowerCase()) {
      skipped++
      console.log(`${indent}  ⏭️  ${file.name} (already yours)`)
    } else {
      console.log(`${indent}  🔄 ${file.name} (owner: ${ownerEmail})`)
      await transferOwnership(file.id, file.name)
    }

    if (isFolder) {
      await processFolder(file.id, depth + 1)
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100))
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
const folderId = process.argv[2]

if (!folderId) {
  console.log('❌ Please provide a folder ID:')
  console.log('   node scripts/transfer-ownership.mjs FOLDER_ID')
  console.log('')
  console.log('   Get the folder ID from the Google Drive URL:')
  console.log('   https://drive.google.com/drive/folders/<FOLDER_ID>')
  process.exit(1)
}

console.log('═══════════════════════════════════════════════════════════')
console.log(`🔑 Transfer Ownership to: ${TARGET_OWNER}`)
console.log(`📂 Root Folder ID: "${folderId}" (${folderId.length} chars)`)
console.log('═══════════════════════════════════════════════════════════')
console.log('')

// Quick connectivity test first
console.log('🔗 Testing Drive API access...')
try {
  const test = await drive.about.get({ fields: 'user' })
  console.log(`✅ Connected as: ${test.data.user.emailAddress}`)
  console.log('')
} catch (err) {
  console.error(`❌ Cannot connect to Drive API: ${err.message}`)
  process.exit(1)
}

// Transfer root folder itself
try {
  const rootMeta = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, owners',
    supportsAllDrives: true,
  })
  const rootOwner = (rootMeta.data.owners && rootMeta.data.owners[0] && rootMeta.data.owners[0].emailAddress) || 'unknown'
  console.log(`📂 Root folder: ${rootMeta.data.name} (owner: ${rootOwner})`)

  if (rootOwner.toLowerCase() !== TARGET_OWNER.toLowerCase()) {
    total++
    await transferOwnership(folderId, rootMeta.data.name || 'Root')
  } else {
    console.log('⏭️  Root folder already owned by you')
  }
} catch (err) {
  console.log(`⚠️  Could not check root folder: ${err.message}`)
}

console.log('')
console.log('Starting recursive scan...')
console.log('')

await processFolder(folderId)

console.log('')
console.log('═══════════════════════════════════════════════════════════')
console.log('📊 Summary:')
console.log(`   Total files scanned: ${total}`)
console.log(`   ✅ Transferred:      ${transferred}`)
console.log(`   ⏭️  Skipped (owned):  ${skipped}`)
console.log(`   ❌ Failed:           ${failed}`)
console.log('═══════════════════════════════════════════════════════════')
