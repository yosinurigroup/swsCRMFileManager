/**
 * BULK Copy & Archive Ownership
 * ─────────────────────────────
 * Takes a PARENT folder containing thousands of sub-folders.
 * For each sub-folder and all nested content:
 *   - If already owned by admin → SKIP entire tree (no recursion)
 *   - If owned by someone else → copy files, recreate folders, archive originals
 *
 * Usage:  node scripts/bulk-copy-and-archive.mjs PARENT_FOLDER_ID
 *
 * Resume-safe: re-run the same command to pick up where you left off.
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
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
  env[key] = val
}

const TARGET_OWNER = 'admin@y2kgrouphosting.com'
const SKIP_FOLDERS = new Set(['_Archive', '_archivedOriginals'])

// ── Auth ───────────────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(env.NUXT_DRIVE_CLIENT_ID, env.NUXT_DRIVE_CLIENT_SECRET)
oauth2Client.setCredentials({ refresh_token: env.NUXT_DRIVE_REFRESH_TOKEN })
const drive = google.drive({ version: 'v3', auth: oauth2Client })

// ── Counters ───────────────────────────────────────────────────────────────
let copiedFiles = 0
let copiedFolders = 0
let skippedOwned = 0
let failed = 0

// ── Helpers ────────────────────────────────────────────────────────────────
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

async function createFolder(name, parentId) {
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

async function findOrCreateFolder(name, parentId) {
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, owners)',
    supportsAllDrives: true,
  })
  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id
  }
  return await createFolder(name, parentId)
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

function isOwned(file) {
  return getOwner(file).toLowerCase() === TARGET_OWNER.toLowerCase()
}

// ── Check if entire folder tree is already owned ───────────────────────────
// Quick check: if the folder itself is owned by admin, assume tree is done
function isAlreadyProcessed(folder) {
  return isOwned(folder)
}

// ── Process a single folder's contents recursively ─────────────────────────
async function processContents(folderId, archiveFolderId, depth = 0) {
  const indent = '  '.repeat(depth + 1)
  const files = await listAllFiles(folderId)

  for (const file of files) {
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder'

    // Skip system folders
    if (SKIP_FOLDERS.has(file.name)) continue

    // ★ SMART SKIP: if already owned by admin, skip entirely (no recursion)
    if (isOwned(file)) {
      skippedOwned++
      continue
    }

    if (isFolder) {
      // FOLDER not owned by admin → recreate it
      try {
        const tempName = file.name + ' '
        const newFolderId = await findOrCreateFolder(tempName, folderId)

        // Move children from old → new
        const children = await listAllFiles(file.id)
        for (const child of children) {
          await moveFile(child.id, file.id, newFolderId)
          await new Promise(r => setTimeout(r, 30))
        }

        // Archive old empty folder
        await moveFile(file.id, folderId, archiveFolderId)

        // Rename new folder
        await drive.files.update({
          fileId: newFolderId,
          requestBody: { name: file.name },
          supportsAllDrives: true,
        })

        copiedFolders++
        console.log(`${indent}📁 ${file.name} → recreated`)

        // Recurse into the new folder
        await processContents(newFolderId, archiveFolderId, depth + 1)
      } catch (err) {
        failed++
        console.log(`${indent}❌ ${file.name} — ${err.message}`)
      }
    } else {
      // FILE not owned by admin → copy & archive
      try {
        await drive.files.copy({
          fileId: file.id,
          requestBody: { name: file.name, parents: [folderId] },
          fields: 'id',
          supportsAllDrives: true,
        })
        await moveFile(file.id, folderId, archiveFolderId)
        copiedFiles++
        console.log(`${indent}📄 ${file.name} → copied`)
      } catch (err) {
        failed++
        console.log(`${indent}❌ ${file.name} — ${err.message}`)
      }
    }

    await new Promise(r => setTimeout(r, 100))
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
const parentFolderId = process.argv[2]

if (!parentFolderId) {
  console.log('❌ Usage: node scripts/bulk-copy-and-archive.mjs PARENT_FOLDER_ID')
  console.log('   Provide the folder that CONTAINS all the sub-folders.')
  process.exit(1)
}

console.log('═══════════════════════════════════════════════════════════')
console.log(`🔑 BULK Copy & Archive`)
console.log(`👤 Target owner: ${TARGET_OWNER}`)
console.log(`📂 Parent folder: ${parentFolderId}`)
console.log('═══════════════════════════════════════════════════════════')
console.log('')

// Verify connection
try {
  const test = await drive.about.get({ fields: 'user' })
  console.log(`✅ Connected as: ${test.data.user.emailAddress}`)
} catch (err) {
  console.error(`❌ Cannot connect: ${err.message}`)
  process.exit(1)
}

// List all top-level items in parent folder
console.log('📋 Listing top-level folders...')
const topLevelItems = await listAllFiles(parentFolderId)
const topFolders = topLevelItems.filter(f =>
  f.mimeType === 'application/vnd.google-apps.folder' && !SKIP_FOLDERS.has(f.name)
)

console.log(`📊 Found ${topFolders.length} folders to process`)
console.log('')

let processed = 0
let alreadyDone = 0

for (const folder of topFolders) {
  processed++
  const pct = ((processed / topFolders.length) * 100).toFixed(1)

  // ★ SMART SKIP: if folder already owned by admin, skip entire tree
  if (isAlreadyProcessed(folder)) {
    alreadyDone++
    // Print progress every 50 to avoid spam
    if (alreadyDone % 50 === 0 || processed === topFolders.length) {
      console.log(`  [${processed}/${topFolders.length}] ${pct}% — skipped ${alreadyDone} already-owned folders so far...`)
    }
    continue
  }

  console.log(`\n━━━ [${processed}/${topFolders.length}] ${pct}% ━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`📂 ${folder.name} (owner: ${getOwner(folder)})`)

  try {
    // Create _archivedOriginals inside THIS folder
    const archiveId = await findOrCreateFolder('_archivedOriginals', folder.id)

    // If the folder itself is not owned by admin, recreate it
    const tempName = folder.name + ' '
    const newFolderId = await findOrCreateFolder(tempName, parentFolderId)

    // Move children from old folder to new
    const children = await listAllFiles(folder.id)
    // Exclude _archivedOriginals from children to move
    const movableChildren = children.filter(c => c.name !== '_archivedOriginals')
    for (const child of movableChildren) {
      await moveFile(child.id, folder.id, newFolderId)
      await new Promise(r => setTimeout(r, 30))
    }

    // Create archive in the NEW folder (move the _archivedOriginals too if it has content)
    const newArchiveId = await findOrCreateFolder('_archivedOriginals', newFolderId)

    // Move old folder to its own archive (or parent archive)
    // First, check if parent has an archive
    const parentArchiveId = await findOrCreateFolder('_archivedOriginals', parentFolderId)
    await moveFile(folder.id, parentFolderId, parentArchiveId)

    // Rename new folder
    await drive.files.update({
      fileId: newFolderId,
      requestBody: { name: folder.name },
      supportsAllDrives: true,
    })

    copiedFolders++
    console.log(`  ✅ Folder recreated: ${folder.name}`)

    // Process contents recursively
    await processContents(newFolderId, newArchiveId, 0)

    console.log(`  📊 Running totals: ${copiedFiles} files, ${copiedFolders} folders copied, ${skippedOwned} skipped`)
  } catch (err) {
    failed++
    console.log(`  ❌ FAILED: ${folder.name} — ${err.message}`)
  }
}

// Also process any top-level FILES (not in sub-folders)
const topFiles = topLevelItems.filter(f =>
  f.mimeType !== 'application/vnd.google-apps.folder' && !SKIP_FOLDERS.has(f.name)
)
if (topFiles.length > 0) {
  console.log(`\n📄 Processing ${topFiles.length} top-level files...`)
  const parentArchiveId = await findOrCreateFolder('_archivedOriginals', parentFolderId)
  for (const file of topFiles) {
    if (isOwned(file)) { skippedOwned++; continue }
    try {
      await drive.files.copy({
        fileId: file.id,
        requestBody: { name: file.name, parents: [parentFolderId] },
        fields: 'id',
        supportsAllDrives: true,
      })
      await moveFile(file.id, parentFolderId, parentArchiveId)
      copiedFiles++
      console.log(`  📄 ${file.name} → copied`)
    } catch (err) {
      failed++
      console.log(`  ❌ ${file.name} — ${err.message}`)
    }
  }
}

console.log('')
console.log('═══════════════════════════════════════════════════════════')
console.log('📊 FINAL SUMMARY:')
console.log(`   Total top-level folders: ${topFolders.length}`)
console.log(`   ⏭️  Already owned (skipped): ${alreadyDone}`)
console.log(`   📁 Folders recreated:       ${copiedFolders}`)
console.log(`   📄 Files copied:            ${copiedFiles}`)
console.log(`   ⏭️  Nested items skipped:    ${skippedOwned}`)
console.log(`   ❌ Failed:                  ${failed}`)
console.log('═══════════════════════════════════════════════════════════')
