/**
 * Copy & Archive Ownership Script
 * ────────────────────────────────
 * For each file NOT owned by admin@y2kgrouphosting.com:
 *   1. Copies the file (copy owned by admin)
 *   2. Moves the original to _archivedOriginals folder
 *
 * Usage:  node scripts/copy-and-archive.mjs FOLDER_ID
 */

import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── Load .env ──────────────────────────────────────────────────────────────
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

// ── Auth ───────────────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  env.NUXT_DRIVE_CLIENT_ID,
  env.NUXT_DRIVE_CLIENT_SECRET,
)
oauth2Client.setCredentials({ refresh_token: env.NUXT_DRIVE_REFRESH_TOKEN })
const drive = google.drive({ version: 'v3', auth: oauth2Client })

// ── Counters ───────────────────────────────────────────────────────────────
let copied = 0
let skipped = 0
let failed = 0
let total = 0

// ── Helpers ────────────────────────────────────────────────────────────────
async function listAllFiles(folderId) {
  const files = []
  let pageToken
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, owners, parents)',
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

async function findOrCreateFolder(name, parentId) {
  // Check if folder already exists
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
  })
  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id
  }
  // Create new folder
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  })
  return res.data.id
}

async function moveFile(fileId, oldParentId, newParentId) {
  await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: oldParentId,
    supportsAllDrives: true,
  })
}

function getOwner(file) {
  return (file.owners && file.owners[0] && file.owners[0].emailAddress) || 'unknown'
}

function isOwnedByTarget(file) {
  return getOwner(file).toLowerCase() === TARGET_OWNER.toLowerCase()
}

// ── Process folder recursively ─────────────────────────────────────────────
async function processFolder(folderId, archiveFolderId, depth = 0) {
  const indent = '  '.repeat(depth)
  const files = await listAllFiles(folderId)

  console.log(`${indent}📂 Found ${files.length} items`)

  for (const file of files) {
    total++
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
    const owner = getOwner(file)

    // Skip _Archive and _archivedOriginals folders
    if (file.name === '_Archive' || file.name === '_archivedOriginals') {
      skipped++
      console.log(`${indent}  ⏭️  ${file.name} (system folder, skipping)`)
      continue
    }

    if (isOwnedByTarget(file)) {
      skipped++
      console.log(`${indent}  ⏭️  ${file.name} (already yours)`)
      if (isFolder) {
        await processFolder(file.id, archiveFolderId, depth + 1)
      }
      continue
    }

    if (isFolder) {
      // FOLDER: Create new folder owned by admin, move children, archive original
      console.log(`${indent}  📁 ${file.name} (owner: ${owner}) — recreating...`)
      try {
        // Create new folder (owned by admin) in same parent with temp name
        const newFolderId = await findOrCreateFolder(file.name + ' ', folderId)

        // Move all children from old folder to new folder
        const children = await listAllFiles(file.id)
        for (const child of children) {
          await moveFile(child.id, file.id, newFolderId)
          await new Promise(r => setTimeout(r, 50))
        }

        // Move old empty folder to archive
        await moveFile(file.id, folderId, archiveFolderId)

        // Rename new folder (remove trailing space)
        await drive.files.update({
          fileId: newFolderId,
          requestBody: { name: file.name },
          supportsAllDrives: true,
        })

        copied++
        console.log(`${indent}  ✅ Recreated: ${file.name}`)

        // Process the new folder's children recursively
        await processFolder(newFolderId, archiveFolderId, depth + 1)
      } catch (err) {
        failed++
        console.log(`${indent}  ❌ Failed folder: ${file.name} — ${err.message}`)
      }
    } else {
      // FILE: Copy (owned by admin), move original to archive
      console.log(`${indent}  📄 ${file.name} (owner: ${owner}) — copying...`)
      try {
        // Copy file — copy is owned by admin
        await drive.files.copy({
          fileId: file.id,
          requestBody: {
            name: file.name,
            parents: [folderId],
          },
          fields: 'id',
          supportsAllDrives: true,
        })
        // Move original to archive
        await moveFile(file.id, folderId, archiveFolderId)

        copied++
        console.log(`${indent}  ✅ Copied: ${file.name}`)
      } catch (err) {
        failed++
        console.log(`${indent}  ❌ Failed: ${file.name} — ${err.message}`)
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 150))
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
const rootFolderId = process.argv[2]

if (!rootFolderId) {
  console.log('❌ Usage: node scripts/copy-and-archive.mjs FOLDER_ID')
  process.exit(1)
}

console.log('═══════════════════════════════════════════════════════════')
console.log(`🔑 Copy files to be owned by: ${TARGET_OWNER}`)
console.log(`📂 Root Folder ID: ${rootFolderId}`)
console.log('═══════════════════════════════════════════════════════════')
console.log('')

// Test connection
console.log('🔗 Testing Drive API access...')
try {
  const test = await drive.about.get({ fields: 'user' })
  console.log(`✅ Connected as: ${test.data.user.emailAddress}`)
} catch (err) {
  console.error(`❌ Cannot connect: ${err.message}`)
  process.exit(1)
}

// Create _archivedOriginals folder in root
console.log('📦 Setting up _archivedOriginals folder...')
const archiveFolderId = await findOrCreateFolder('_archivedOriginals', rootFolderId)
console.log(`✅ Archive folder ready: ${archiveFolderId}`)
console.log('')

console.log('Starting copy & archive...')
console.log('')

await processFolder(rootFolderId, archiveFolderId)

console.log('')
console.log('═══════════════════════════════════════════════════════════')
console.log('📊 Summary:')
console.log(`   Total scanned:  ${total}`)
console.log(`   ✅ Copied:       ${copied}`)
console.log(`   ⏭️  Skipped:      ${skipped}`)
console.log(`   ❌ Failed:       ${failed}`)
console.log('═══════════════════════════════════════════════════════════')
