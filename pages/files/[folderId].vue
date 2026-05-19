<script setup lang="ts">
import type { DriveFile } from '~/composables/useDriveManager'

const route = useRoute()
const rootId = computed(() => route.params.folderId as string)
const dm = useDriveManager(rootId)

// Session
const session = ref<{authenticated:boolean,email?:string,name?:string,folderId?:string}>({authenticated:false})
onMounted(async () => {
  try {
    const s = await $fetch<any>('/api/auth/session')
    session.value = s
  } catch {}
})

// Total size of all files
const totalSizeFormatted = computed(() => {
  const total = dm.files.value.reduce((sum, f) => sum + (f.size ? parseInt(f.size) : 0), 0)
  if (total === 0) return ''
  if (total < 1024) return `${total} B`
  if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} KB`
  if (total < 1024 * 1024 * 1024) return `${(total / 1024 / 1024).toFixed(1)} MB`
  return `${(total / 1024 / 1024 / 1024).toFixed(2)} GB`
})

// Upload state
const isDragging = ref(false)
const isUploading = ref(false)
const uploadProgress = ref(0)
const uploadTotal = ref(0)
const uploadCurrent = ref(0)
const uploadCurrentName = ref('')
const fileInputRef = ref<HTMLInputElement|null>(null)
const folderInputRef = ref<HTMLInputElement|null>(null)
let dragCounter = 0

// Rename state
const renamingFile = ref<DriveFile|null>(null)
const renameValue = ref('')
const renameLoading = ref(false)

// New folder state
const showNewFolder = ref(false)
const newFolderName = ref('')
const newFolderLoading = ref(false)

// Create Google Doc/Sheet/Slides state
const showCreateGdoc = ref(false)
const createGdocType = ref<'sheet'|'doc'|'slides'>('sheet')
const createGdocName = ref('')
const createGdocLoading = ref(false)
const showCreateDropdown = ref(false)

const GDOC_TYPES = [
  { type: 'sheet'  as const, label: 'Google Sheet',        icon: 'i-lucide-table',        color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  { type: 'doc'    as const, label: 'Google Doc',          icon: 'i-lucide-file-text',    color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  { type: 'slides' as const, label: 'Google Slides',       icon: 'i-lucide-presentation', color: '#f97316', bg: 'rgba(249,115,22,0.12)'  },
]

// Multi-select state
const selectedIds = ref<Set<string>>(new Set())
const isSelectMode = computed(() => selectedIds.value.size > 0)
function toggleSelect(f: DriveFile, e?: Event) {
  e?.stopPropagation()
  const s = new Set(selectedIds.value)
  if (s.has(f.id)) s.delete(f.id); else s.add(f.id)
  selectedIds.value = s
}
function selectAll() {
  if (selectedIds.value.size === dm.sorted.value.length) { selectedIds.value = new Set(); return }
  selectedIds.value = new Set(dm.sorted.value.map(f => f.id))
}
function clearSelection() { selectedIds.value = new Set() }
const selectedFiles = computed(() => dm.sorted.value.filter(f => selectedIds.value.has(f.id)))

// Move state
const movingFile = ref<DriveFile|null>(null)
const movePickerStack = ref<{id:string,name:string}[]>([])
const movePickerFiles = ref<DriveFile[]>([])
const movePickerLoading = ref(false)
const moveLoading = ref(false)

// ── Internal drag-to-move ────────────────────────────────────────────────────
const draggingItem = ref<DriveFile|null>(null)
const dragOverId = ref<string|null>(null)
const isInternalDrag = ref(false)

onMounted(() => { if(rootId.value) dm.fetchFiles(rootId.value) })

useHead({ title: 'File Manager — SWS Drive' })

// ── View mode: 'list' | 'gallery' ────────────────────────────────────────────
const VIEW_KEY = 'sws_fm_view'
const viewMode = ref<'list'|'gallery'>(
  (typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null) as 'list'|'gallery' || 'list'
)
function setView(mode: 'list'|'gallery') {
  viewMode.value = mode
  if (typeof localStorage !== 'undefined') localStorage.setItem(VIEW_KEY, mode)
}

// Upload handlers
function onFileInput(e: Event) {
  if (isUploading.value) return // prevent double-fire (Chrome webkitdirectory quirk)
  const input = e.target as HTMLInputElement
  if(input.files?.length) doUpload(Array.from(input.files), [])
  input.value = ''
}

function onFolderInput(e: Event) {
  if (isUploading.value) return // prevent double-fire (Chrome webkitdirectory quirk)
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  const files = Array.from(input.files)
  // webkitRelativePath gives us e.g. "FolderName/sub/file.txt"
  const paths = files.map(f => (f as any).webkitRelativePath || f.name)
  doUpload(files, paths)
  input.value = ''
}

// Threshold: files larger than this use chunked resumable upload
const RESUMABLE_THRESHOLD = 4 * 1024 * 1024 // 4MB (Vercel free tier limit is ~4.5MB)
const CHUNK_SIZE = 3.5 * 1024 * 1024 // 3.5MB chunks — must fit within Vercel's 4.5MB body limit with overhead

/**
 * Upload a small file through the server endpoint (< 4MB)
 */
async function uploadSmallFile(file: File, folderId: string, relativePath: string): Promise<boolean> {
  const fd = new FormData()
  fd.append('folderId', folderId)
  fd.append('files', file)
  fd.append('relativePaths', JSON.stringify([relativePath]))
  try {
    await $fetch('/api/drive/upload', { method: 'POST', body: fd })
    return true
  } catch (err: any) {
    const errMsg = err?.data?.statusMessage || err?.message || 'Upload failed'
    console.error(`Upload failed for ${file.name}:`, errMsg)
    showToast(`Failed: ${file.name}`)
    return false
  }
}

/**
 * Upload a large file using chunked resumable upload through our server proxy.
 * 1. Server creates a resumable session URL on Google Drive
 * 2. Client sends chunks to our server proxy, which forwards them to Google
 * This avoids both Vercel body limits and CORS issues.
 */
async function uploadLargeFile(file: File, folderId: string): Promise<boolean> {
  try {
    // Step 1: Get resumable upload session from our server
    const session = await $fetch<{success:boolean, uploadUri:string, accessToken:string}>('/api/drive/upload-session', {
      method: 'POST',
      body: { folderId, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size },
    })

    if (!session.uploadUri) {
      showToast(`Failed: ${file.name} — no upload session`)
      return false
    }

    // Step 2: Upload chunks through our server proxy
    const totalSize = file.size
    let offset = 0

    while (offset < totalSize) {
      const end = Math.min(offset + CHUNK_SIZE, totalSize)
      const chunk = file.slice(offset, end)
      const chunkArrayBuffer = await chunk.arrayBuffer()

      try {
        // Send chunk to our server proxy which forwards to Google Drive
        const params = new URLSearchParams({
          uploadUri: session.uploadUri,
          start: String(offset),
          end: String(end),
          total: String(totalSize),
          mimeType: file.type || 'application/octet-stream',
        })

        const res = await fetch(`/api/drive/upload-chunk?${params.toString()}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunkArrayBuffer,
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ statusMessage: res.statusText }))
          console.error(`Chunk upload failed for ${file.name}:`, errData)
          showToast(`Failed: ${file.name}`)
          return false
        }
      } catch (err: any) {
        console.error(`Chunk upload error for ${file.name}:`, err)
        showToast(`Failed: ${file.name}`)
        return false
      }

      offset = end
      // Update progress within this file
      const filePct = Math.round((offset / totalSize) * 100)
      uploadCurrentName.value = `${file.name} (${filePct}%)`
    }

    return true
  } catch (err: any) {
    console.error(`Resumable upload failed for ${file.name}:`, err)
    showToast(`Failed: ${file.name}`)
    return false
  }
}

async function uploadSingleFile(file: File, folderId: string, relativePath: string): Promise<boolean> {
  if (file.size > RESUMABLE_THRESHOLD) {
    return uploadLargeFile(file, folderId)
  }
  return uploadSmallFile(file, folderId, relativePath)
}

async function doUpload(files: File[], paths: string[]) {
  isUploading.value = true
  uploadTotal.value = files.length
  uploadCurrent.value = 0
  uploadProgress.value = 0
  let successCount = 0
  let failCount = 0
  const folderId = dm.currentFolderId.value
  if (!folderId) { isUploading.value = false; return }
  for (let i = 0; i < files.length; i++) {
    uploadCurrent.value = i + 1
    uploadCurrentName.value = files[i]!.name
    uploadProgress.value = Math.round(((i) / files.length) * 100)
    const ok = await uploadSingleFile(files[i]!, folderId, paths[i] || files[i]!.name)
    if (ok) successCount++; else failCount++
  }
  uploadProgress.value = 100
  await dm.fetchFiles(folderId)
  if (failCount === 0) {
    showToast(`${successCount} file${successCount > 1 ? 's' : ''} uploaded`)
  } else {
    showToast(`${successCount} uploaded, ${failCount} failed`)
  }
  setTimeout(() => { isUploading.value = false; uploadProgress.value = 0 }, 600)
}
function onDragEnter(e: DragEvent) {
  e.preventDefault()
  if (isInternalDrag.value) return
  dragCounter++; isDragging.value = true
}
function onDragLeave(e: DragEvent) { e.preventDefault(); dragCounter--; if(dragCounter<=0){isDragging.value=false;dragCounter=0} }
function onDragOver(e: DragEvent) { e.preventDefault() }

// Internal drag-to-move handlers
function onFileDragStart(e: DragEvent, f: DriveFile) {
  draggingItem.value = f; isInternalDrag.value = true
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('application/x-sws-move', f.id)
}
function onFileDragEnd() { draggingItem.value = null; dragOverId.value = null; isInternalDrag.value = false }
function onFolderDragOver(e: DragEvent, folderId: string) {
  if (!isInternalDrag.value || draggingItem.value?.id === folderId) return
  e.preventDefault(); e.stopPropagation()
  e.dataTransfer!.dropEffect = 'move'; dragOverId.value = folderId
}
function onFolderDragLeave() { dragOverId.value = null }
async function onFolderDrop(e: DragEvent, folder: DriveFile) {
  e.preventDefault(); e.stopPropagation(); dragOverId.value = null
  if (!isInternalDrag.value || !draggingItem.value) return
  const src = draggingItem.value; isInternalDrag.value = false; draggingItem.value = null
  const filesToMove = selectedIds.value.has(src.id) && selectedIds.value.size > 1 ? [...selectedFiles.value] : [src]
  moveLoading.value = true
  try {
    for (const f of filesToMove) await dm.moveFile(f.id, folder.id)
    if (selectedIds.value.has(src.id)) clearSelection()
    showToast(`${filesToMove.length} item${filesToMove.length > 1 ? 's' : ''} moved to "${folder.name}"`)
    await dm.fetchFiles(dm.currentFolderId.value!)
  } catch { showToast('Move failed') } finally { moveLoading.value = false }
}
async function onAncestorDrop(e: DragEvent, targetId: string, targetName: string) {
  e.preventDefault(); e.stopPropagation(); dragOverId.value = null
  if (!isInternalDrag.value || !draggingItem.value) return
  const src = draggingItem.value; isInternalDrag.value = false; draggingItem.value = null
  const filesToMove = selectedIds.value.has(src.id) && selectedIds.value.size > 1 ? [...selectedFiles.value] : [src]
  moveLoading.value = true
  try {
    for (const f of filesToMove) await dm.moveFile(f.id, targetId)
    if (selectedIds.value.has(src.id)) clearSelection()
    showToast(`${filesToMove.length} item${filesToMove.length > 1 ? 's' : ''} moved to "${targetName}"`)
    await dm.fetchFiles(dm.currentFolderId.value!)
  } catch { showToast('Move failed') } finally { moveLoading.value = false }
}

/** Recursively collect all File objects + their relative paths from a FileSystemEntry */
async function collectEntryFiles(entry: FileSystemEntry, basePath: string): Promise<{file: File, path: string}[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (f) => resolve([{ file: f, path: basePath ? `${basePath}/${f.name}` : f.name }]),
        () => resolve([])
      )
    })
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const dirPath = basePath ? `${basePath}/${dirEntry.name}` : dirEntry.name
    return new Promise((resolve) => {
      const reader = dirEntry.createReader()
      const allEntries: FileSystemEntry[] = []
      function readBatch() {
        reader.readEntries(async (batch) => {
          if (batch.length === 0) {
            // Done reading; recurse into each child
            const results: {file: File, path: string}[] = []
            for (const child of allEntries) {
              const childFiles = await collectEntryFiles(child, dirPath)
              results.push(...childFiles)
            }
            resolve(results)
          } else {
            allEntries.push(...batch)
            readBatch()
          }
        }, () => resolve([]))
      }
      readBatch()
    })
  }
  return []
}

async function onDrop(e: DragEvent) {
  e.preventDefault(); isDragging.value = false; dragCounter = 0
  if (!e.dataTransfer) return
  // Ignore internal drag-to-move
  if (isInternalDrag.value || e.dataTransfer.types.includes('application/x-sws-move')) {
    isInternalDrag.value = false; draggingItem.value = null; dragOverId.value = null; return
  }

  // Use FileSystem API when available (supports folders)
  const items = Array.from(e.dataTransfer.items)
  const hasEntryAPI = items.length > 0 && typeof items[0]!.webkitGetAsEntry === 'function'

  if (hasEntryAPI) {
    const collected: {file: File, path: string}[] = []
    for (const item of items) {
      const entry = item.webkitGetAsEntry()
      if (entry) {
        const results = await collectEntryFiles(entry, '')
        collected.push(...results)
      }
    }
    if (collected.length) {
      doUpload(collected.map(c => c.file), collected.map(c => c.path))
    }
  } else {
    // Fallback: plain files only
    const files = Array.from(e.dataTransfer.files)
    if (files.length) doUpload(files, files.map(f => f.name))
  }
}

// Rename
function startRename(f: DriveFile) {
  renamingFile.value = f; renameValue.value = f.name
}
async function confirmRename() {
  if(!renamingFile.value || !renameValue.value.trim()) return
  renameLoading.value = true
  try { await dm.renameFile(renamingFile.value.id, renameValue.value.trim()); renamingFile.value = null }
  catch {} finally { renameLoading.value = false }
}

// Create Google Workspace file
async function confirmCreateGdoc() {
  if (!createGdocName.value.trim() || createGdocLoading.value) return
  createGdocLoading.value = true
  try {
    const r = await $fetch<{success:boolean,file:any,webViewLink:string}>('/api/drive/create-gdoc', {
      method: 'POST',
      body: { parentId: dm.currentFolderId.value, name: createGdocName.value.trim(), type: createGdocType.value },
    })
    showCreateGdoc.value = false
    createGdocName.value = ''
    showToast(`"${r.file.name}" created`)
    await dm.fetchFiles(dm.currentFolderId.value!)
    // Open in new tab immediately
    if (r.webViewLink) window.open(r.webViewLink, '_blank')
  } catch { showToast('Failed to create file') }
  finally { createGdocLoading.value = false }
}

function openCreateGdoc(type: 'sheet'|'doc'|'slides') {
  createGdocType.value = type
  createGdocName.value = ''
  showCreateGdoc.value = true
  showCreateDropdown.value = false
}

// Close create dropdown on outside click
onMounted(() => {
  document.addEventListener('click', () => { showCreateDropdown.value = false })
})

// New folder
async function confirmNewFolder() {
  if(!newFolderName.value.trim()) return
  newFolderLoading.value = true
  try {
    await dm.createFolder(newFolderName.value.trim())
    showNewFolder.value = false; newFolderName.value = ''
    showToast('Folder created')
    await dm.fetchFiles(dm.currentFolderId.value!)
  }
  catch {} finally { newFolderLoading.value = false }
}

// Move
const movePickerCurrentId = computed(() =>
  movePickerStack.value.length > 0 ? movePickerStack.value[movePickerStack.value.length-1]!.id : rootId.value
)
const moveNewFolderName = ref('')
const moveNewFolderLoading = ref(false)
const showMoveNewFolder = ref(false)
async function fetchMovePickerFiles(fid: string) {
  movePickerLoading.value = true
  try {
    const d = await $fetch<{success:boolean,files:DriveFile[]}>(`/api/drive/files?folderId=${fid}`)
    movePickerFiles.value = (d.files||[]).filter(f => f.mimeType === 'application/vnd.google-apps.folder' && f.id !== movingFile.value?.id && f.name !== '_Archive' && f.name !== '_ConvertedFiles')
  } catch { movePickerFiles.value = [] }
  finally { movePickerLoading.value = false }
}
function startMove(f: DriveFile) {
  movingFile.value = f; movePickerStack.value = []; showMoveNewFolder.value = false; moveNewFolderName.value = ''; fetchMovePickerFiles(rootId.value)
}
function movePickerOpen(folder: DriveFile) {
  movePickerStack.value.push({id:folder.id,name:folder.name}); showMoveNewFolder.value = false; fetchMovePickerFiles(folder.id)
}
function movePickerBack() {
  movePickerStack.value.pop(); showMoveNewFolder.value = false; fetchMovePickerFiles(movePickerCurrentId.value)
}
async function confirmMove(destId: string) {
  if(!movingFile.value) return
  moveLoading.value = true
  const isBulk = movingFile.value.id === '__bulk__'
  const filesToMove = isBulk ? [...selectedFiles.value] : [movingFile.value]
  const count = filesToMove.length
  try {
    for (const f of filesToMove) {
      await dm.moveFile(f.id, destId)
    }
    movingFile.value = null; if (isBulk) clearSelection()
    showToast(`${count} item${count > 1 ? 's' : ''} moved`)
    await dm.fetchFiles(dm.currentFolderId.value!)
  }
  catch {} finally { moveLoading.value = false }
}
async function createMoveFolder() {
  if(!moveNewFolderName.value.trim()) return
  moveNewFolderLoading.value = true
  try {
    const parentId = movePickerCurrentId.value
    const r = await $fetch<{success:boolean,folder:DriveFile}>('/api/drive/create-folder', {
      method:'POST', body:{parentId, name: moveNewFolderName.value.trim()}
    })
    moveNewFolderName.value = ''; showMoveNewFolder.value = false
    await fetchMovePickerFiles(parentId)
  } catch {} finally { moveNewFolderLoading.value = false }
}

async function doCopy(f: DriveFile) { try { await dm.copyFile(f.id); showToast(`"${f.name}" copied`) } catch {} }

// Delete with confirmation (archives behind the scenes)
const deletingFiles = ref<DriveFile[]>([])
const deleteLoading = ref(false)
function startDelete(f: DriveFile) { deletingFiles.value = [f] }
function startBulkDelete() { deletingFiles.value = [...selectedFiles.value] }
async function confirmDelete() {
  if (!deletingFiles.value.length) return
  deleteLoading.value = true
  const count = deletingFiles.value.length
  try {
    for (const f of deletingFiles.value) { await dm.deleteFile(f.id) }
    deletingFiles.value = []; clearSelection()
    showToast(`${count} item${count > 1 ? 's' : ''} deleted`)
    await dm.fetchFiles(dm.currentFolderId.value!)
  }
  catch {} finally { deleteLoading.value = false }
}

// Bulk move
function startBulkMove() {
  // Use the first selected file for the move modal, then move all
  if (selectedFiles.value.length === 0) return
  movingFile.value = { id: '__bulk__', name: `${selectedFiles.value.length} items`, mimeType: '' } as DriveFile
  movePickerStack.value = []; showMoveNewFolder.value = false; moveNewFolderName.value = ''; fetchMovePickerFiles(rootId.value)
}

// Bulk download
async function bulkDownload() {
  for (const f of selectedFiles.value) {
    if (!dm.isFolder(f)) dm.downloadFile(f)
  }
  showToast(`Downloading ${selectedFiles.value.filter(f => !dm.isFolder(f)).length} files`)
}

// Toast
const toastMsg = ref('')
const toastVisible = ref(false)
let toastTimer: any = null
function showToast(msg: string) {
  toastMsg.value = msg; toastVisible.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastVisible.value = false }, 2500)
}

// Keyboard navigation
const prevFile = computed(() => {
  if (!dm.selected.value) return null
  const sorted = dm.sorted.value
  const idx = sorted.findIndex(f => f.id === dm.selected.value!.id)
  return idx > 0 ? sorted[idx - 1]! : null
})
const nextFile = computed(() => {
  if (!dm.selected.value) return null
  const sorted = dm.sorted.value
  const idx = sorted.findIndex(f => f.id === dm.selected.value!.id)
  return idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1]! : null
})
const selectedIndex = computed(() => {
  if (!dm.selected.value) return -1
  return dm.sorted.value.findIndex(f => f.id === dm.selected.value!.id)
})
function navigatePrev() {
  if (!prevFile.value) return
  dm.openFile(prevFile.value)
  nextTick(() => document.getElementById('file-item-' + prevFile.value!.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
function navigateNext() {
  if (!nextFile.value) return
  dm.openFile(nextFile.value)
  nextTick(() => document.getElementById('file-item-' + nextFile.value!.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
function onKeyDown(e: KeyboardEvent) {
  if (!dm.selected.value) return
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  const sorted = dm.sorted.value
  const idx = sorted.findIndex(f => f.id === dm.selected.value!.id)
  if (idx === -1) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault()
    navigateNext()
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault()
    navigatePrev()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    dm.selected.value = null
  }
}
onMounted(() => document.addEventListener('keydown', onKeyDown))
onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
</script>

<template>
<div class="h-screen flex flex-col" style="background:var(--surface-primary)" @dragenter="onDragEnter" @dragleave="onDragLeave" @dragover="onDragOver" @drop="onDrop">

  <!-- TOAST -->
  <transition enter-active-class="transition-all duration-300 ease-out" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-active-class="transition-all duration-200" leave-from-class="opacity-100" leave-to-class="opacity-0 -translate-y-2">
    <div v-if="toastVisible" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium" style="background:var(--surface-elevated);border:1px solid var(--border-medium);color:var(--text-primary);box-shadow:0 8px 30px rgba(0,0,0,0.4)">
      <Icon name="i-lucide-check-circle-2" class="w-4 h-4 shrink-0" style="color:#1da462"/>
      {{ toastMsg }}
    </div>
  </transition>

  <!-- HEADER -->
  <div class="flex items-center gap-3 px-5 py-3 shrink-0" style="border-bottom:1px solid var(--border-subtle);background:var(--surface-card)">
    <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background:linear-gradient(135deg,#1da462,#0f7b3f)">
      <svg class="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 19.5l3-5.25H21l-3 5.25H4.5z" opacity=".7"/><path d="M12 4.5L4.5 17.25l3 2.25L15 7.5 12 4.5z" opacity=".85"/><path d="M21 15l-4.5-7.5L13.5 9l4.5 7.5L21 15z"/></svg>
    </div>
    <!-- Breadcrumbs -->
    <div class="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
      <button
        class="text-sm font-bold shrink-0 rounded-md px-1 -mx-1 transition-all"
        :style="{color:'var(--text-primary)', background: dragOverId===rootId?'rgba(139,92,246,0.15)':'transparent', outline: dragOverId===rootId?'2px solid rgba(139,92,246,0.5)':'none'}"
        @click="dm.goToRoot()"
        @dragover.prevent="isInternalDrag&&draggingItem?.id!==rootId?(dragOverId=rootId):''"
        @dragleave="dragOverId=null"
        @drop="onAncestorDrop($event, rootId, dm.rootFolderName.value||'Files')"
      >{{dm.rootFolderName.value || 'Files'}}</button>
      <template v-for="(c,i) in dm.folderStack.value" :key="c.id">
        <Icon name="i-lucide-chevron-right" class="w-3.5 h-3.5 shrink-0" style="color:var(--text-tertiary)"/>
        <button
          class="text-sm truncate max-w-[180px] shrink-0 rounded-md px-1 -mx-1 transition-all"
          :style="{color: i===dm.folderStack.value.length-1?'var(--text-primary)':'var(--text-secondary)', fontWeight: i===dm.folderStack.value.length-1?'600':'400', background: dragOverId===c.id?'rgba(139,92,246,0.15)':'transparent', outline: dragOverId===c.id?'2px solid rgba(139,92,246,0.5)':'none'}"
          @click="dm.goToBreadcrumb(i)"
          @dragover.prevent="isInternalDrag&&draggingItem?.id!==c.id?(dragOverId=c.id):''"
          @dragleave="dragOverId=null"
          @drop="onAncestorDrop($event, c.id, c.name)"
        >{{c.name}}</button>
      </template>
    </div>
    <!-- Total size -->
    <span class="text-xs font-medium shrink-0 tabular-nums" style="color:var(--text-tertiary)">{{totalSizeFormatted}}</span>
    <!-- Actions -->
    <div class="flex items-center gap-2 shrink-0">
      <button class="btn-icon" @click="dm.fetchFiles(dm.currentFolderId.value!)"><Icon name="i-lucide-refresh-cw" class="w-4 h-4" :class="{'animate-spin':dm.loading.value}"/></button>
      <button class="btn-ghost" @click="showNewFolder=true"><Icon name="i-lucide-folder-plus" class="w-3.5 h-3.5"/>New Folder</button>
      <!-- Create Google Doc/Sheet/Slides dropdown -->
      <div class="relative" @click.stop>
        <button class="btn-ghost" @click="showCreateDropdown=!showCreateDropdown">
          <Icon name="i-lucide-plus" class="w-3.5 h-3.5"/>
          New
          <Icon name="i-lucide-chevron-down" class="w-3 h-3 ml-0.5" :style="{transform: showCreateDropdown ? 'rotate(180deg)' : '', transition:'transform 0.15s'}"/>
        </button>
        <Transition enter-active-class="transition-all duration-150" enter-from-class="opacity-0 scale-95 -translate-y-1" enter-to-class="opacity-100 scale-100 translate-y-0" leave-active-class="transition-all duration-100" leave-from-class="opacity-100" leave-to-class="opacity-0 scale-95 -translate-y-1">
          <div v-if="showCreateDropdown" class="absolute right-0 top-full mt-1 rounded-xl overflow-hidden z-50" style="min-width:190px;background:var(--surface-card);border:1px solid var(--border-subtle);box-shadow:0 8px 24px rgba(0,0,0,0.35)">
            <button v-for="gt in GDOC_TYPES" :key="gt.type"
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors"
              style="color:var(--text-primary)"
              @click="openCreateGdoc(gt.type)">
              <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" :style="{background:gt.bg}">
                <Icon :name="gt.icon" class="w-3.5 h-3.5" :style="{color:gt.color}"/>
              </div>
              <span class="font-medium text-[13px]">{{gt.label}}</span>
            </button>
          </div>
        </Transition>
      </div>
      <!-- Upload split button: files + folder -->
      <div class="flex items-center rounded-xl overflow-hidden shrink-0" style="border:1.5px solid #1da462">
        <button class="flex items-center gap-1.5 px-3 h-9 text-sm font-semibold transition-all" style="background:linear-gradient(135deg,#1da462,#0f7b3f);color:#fff" :disabled="isUploading" @click="fileInputRef?.click()" title="Upload files">
          <Icon :name="isUploading?'i-lucide-loader-2':'i-lucide-upload'" class="w-4 h-4" :class="{'animate-spin':isUploading}"/>
          Upload
        </button>
        <div style="width:1px;height:100%;background:rgba(255,255,255,0.25)"></div>
        <button class="flex items-center gap-1.5 px-3 h-9 text-sm font-semibold transition-all" style="background:linear-gradient(135deg,#178a52,#0c6633);color:#fff" :disabled="isUploading" @click="folderInputRef?.click()" title="Upload folder">
          <Icon name="i-lucide-folder-up" class="w-4 h-4"/>
          Folder
        </button>
      </div>
      <input ref="fileInputRef" type="file" multiple class="hidden" @change="onFileInput">
      <input ref="folderInputRef" type="file" multiple class="hidden" webkitdirectory @change="onFolderInput">

      <!-- User badge -->
      <div v-if="session.authenticated" class="flex items-center gap-2 pl-2 ml-1" style="border-left:1px solid var(--border-subtle)">
        <div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style="background:linear-gradient(135deg,#1da462,#0f7b3f)">
          {{(session.name || session.email || 'U').charAt(0).toUpperCase()}}
        </div>
        <div class="hidden sm:block">
          <p class="text-xs font-semibold leading-tight" style="color:var(--text-primary)">{{session.name}}</p>
        </div>
      </div>
    </div>
  </div>

  <!-- NEW FOLDER BAR -->
  <div v-if="showNewFolder" class="flex items-center gap-3 px-5 py-2.5 shrink-0" style="border-bottom:1px solid var(--border-subtle);background:var(--surface-elevated)">
    <Icon name="i-lucide-folder-plus" class="w-4 h-4" style="color:#3b82f6"/>
    <input v-model="newFolderName" class="input-base flex-1" style="height:36px" placeholder="Folder name…" @keydown.enter="confirmNewFolder" @keydown.escape="showNewFolder=false" autofocus>
    <button class="btn-primary" :disabled="!newFolderName.trim()||newFolderLoading" @click="confirmNewFolder">Create</button>
    <button class="btn-icon" @click="showNewFolder=false"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
  </div>

  <!-- DRAG OVERLAY -->
  <div v-if="isDragging" class="drag-overlay" style="position:fixed;inset:0;z-index:100">
    <div class="flex flex-col items-center gap-4">
      <div class="w-20 h-20 rounded-3xl flex items-center justify-center animate-bounce" style="background:rgba(29,164,98,0.15)">
        <Icon name="i-lucide-upload-cloud" class="w-10 h-10" style="color:#1da462"/>
      </div>
      <p class="text-lg font-bold" style="color:#1da462">Drop files or folders here</p>
      <p class="text-sm" style="color:rgba(29,164,98,0.7)">Folder structures will be preserved</p>
    </div>
  </div>

  <!-- RENAME MODAL -->
  <div v-if="renamingFile" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" @click.self="renamingFile=null">
    <div class="w-full max-w-md mx-4 p-5 rounded-2xl" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
      <p class="text-sm font-semibold mb-3" style="color:var(--text-primary)">Rename</p>
      <input v-model="renameValue" class="input-base mb-4" @keydown.enter="confirmRename" autofocus>
      <div class="flex gap-2 justify-end">
        <button class="btn-ghost" @click="renamingFile=null">Cancel</button>
        <button class="btn-primary" :disabled="!renameValue.trim()||renameLoading" @click="confirmRename">Rename</button>
      </div>
    </div>
  </div>

  <!-- MOVE MODAL -->
  <div v-if="movingFile" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" @click.self="movingFile=null">
    <div class="w-full max-w-md mx-4 rounded-2xl overflow-hidden" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
      <div class="flex items-center gap-3 px-5 py-3" style="border-bottom:1px solid var(--border-subtle);background:var(--surface-elevated)">
        <Icon name="i-lucide-folder-symlink" class="w-4 h-4" style="color:#8b5cf6"/>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold" style="color:var(--text-primary)">Move "{{movingFile.name}}"</p>
          <p class="text-[11px]" style="color:var(--text-tertiary)">Select destination folder</p>
        </div>
        <button class="btn-icon" @click="movingFile=null"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
      </div>
      <!-- Breadcrumb -->
      <div class="flex items-center gap-1 px-4 py-2 text-xs overflow-x-auto no-scrollbar" style="border-bottom:1px solid var(--border-subtle);color:var(--text-tertiary)">
        <button class="font-medium shrink-0" style="color:var(--text-secondary)" @click="movePickerStack=[];fetchMovePickerFiles(rootId)">Root</button>
        <template v-for="(c,i) in movePickerStack" :key="c.id">
          <Icon name="i-lucide-chevron-right" class="w-3 h-3 shrink-0"/>
          <button class="shrink-0 truncate max-w-[100px]" :style="{color:i===movePickerStack.length-1?'var(--text-primary)':'var(--text-secondary)'}" @click="movePickerStack=movePickerStack.slice(0,i+1);fetchMovePickerFiles(c.id)">{{c.name}}</button>
        </template>
      </div>
      <!-- Folder list -->
      <div class="max-h-[300px] overflow-y-auto">
        <button v-if="movePickerStack.length>0" class="w-full flex items-center gap-3 px-4 py-2.5 text-left" style="border-bottom:1px solid var(--border-subtle)" @click="movePickerBack()"><Icon name="i-lucide-arrow-left" class="w-4 h-4" style="color:var(--text-tertiary)"/><span class="text-sm" style="color:var(--text-secondary)">Back</span></button>
        <div v-if="movePickerLoading" class="flex items-center justify-center py-10"><Icon name="i-lucide-loader-2" class="w-6 h-6 animate-spin" style="color:var(--text-tertiary)"/></div>
        <div v-else-if="movePickerFiles.length===0" class="flex flex-col items-center py-10 gap-2"><Icon name="i-lucide-folder-x" class="w-8 h-8" style="color:var(--text-tertiary);opacity:0.3"/><p class="text-xs" style="color:var(--text-tertiary)">No subfolders</p></div>
        <div v-for="folder in movePickerFiles" :key="folder.id" class="group w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer" style="border-bottom:1px solid var(--border-subtle)" @click="movePickerOpen(folder)">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background:rgba(245,158,11,0.1)"><Icon name="i-lucide-folder" class="w-4 h-4" style="color:#f59e0b"/></div>
          <span class="text-sm flex-1 truncate" style="color:var(--text-primary)">{{folder.name}}</span>
          <div class="btn-icon opacity-0 group-hover:opacity-100 cursor-pointer" style="width:24px;height:24px" title="Move here" @click.stop="confirmMove(folder.id)"><Icon name="i-lucide-check" class="w-3.5 h-3.5" style="color:#1da462"/></div>
          <Icon name="i-lucide-chevron-right" class="w-3.5 h-3.5" style="color:var(--text-tertiary)"/>
        </div>
      </div>
      <!-- Footer -->
      <div class="px-4 py-3 space-y-2" style="border-top:1px solid var(--border-subtle)">
        <!-- New folder inline -->
        <div v-if="showMoveNewFolder" class="flex items-center gap-2">
          <input v-model="moveNewFolderName" class="input-base flex-1" style="height:32px;font-size:13px" placeholder="New folder name…" @keydown.enter="createMoveFolder" @keydown.escape="showMoveNewFolder=false" autofocus>
          <button class="btn-primary" style="height:32px;padding:0 12px;font-size:12px" :disabled="!moveNewFolderName.trim()||moveNewFolderLoading" @click="createMoveFolder">
            <Icon :name="moveNewFolderLoading?'i-lucide-loader-2':'i-lucide-check'" class="w-3.5 h-3.5" :class="{'animate-spin':moveNewFolderLoading}"/>
          </button>
          <button class="btn-icon" style="width:32px;height:32px" @click="showMoveNewFolder=false"><Icon name="i-lucide-x" class="w-3.5 h-3.5"/></button>
        </div>
        <div v-else class="flex items-center gap-2">
          <button class="btn-ghost flex-1 justify-center" @click="showMoveNewFolder=true"><Icon name="i-lucide-folder-plus" class="w-3.5 h-3.5"/>New Folder</button>
        </div>
        <button class="btn-primary w-full justify-center" :disabled="moveLoading||movePickerCurrentId===dm.currentFolderId.value" @click="confirmMove(movePickerCurrentId)">
          <Icon :name="moveLoading?'i-lucide-loader-2':'i-lucide-folder-symlink'" class="w-4 h-4" :class="{'animate-spin':moveLoading}"/>
          Move to {{movePickerStack.length>0?movePickerStack[movePickerStack.length-1]!.name:'Root'}}
        </button>
      </div>
    </div>
  </div>

  <!-- BODY -->
  <div class="flex flex-1 min-h-0 overflow-hidden">
    <!-- FILE LIST -->
    <div class="flex flex-col min-h-0 overflow-hidden transition-all duration-300" :style="{width: dm.selected.value?'50%':'100%', minWidth: dm.selected.value?'50%':'0', borderRight: dm.selected.value?'1px solid var(--border-subtle)':'none'}">
      <!-- Column header + view toggle (always visible) -->
      <div class="flex items-center gap-3 px-5 py-2 shrink-0 text-xs font-medium uppercase tracking-wider" style="color:var(--text-tertiary);border-bottom:1px solid var(--border-subtle);background:var(--surface-card)">
        <!-- Back button (far left) -->
        <button v-if="dm.folderStack.value.length > 0" class="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold normal-case tracking-normal transition-all shrink-0" style="background:var(--surface-elevated);border:1px solid var(--border-subtle);color:var(--text-secondary)" @click="dm.goBack()" title="Go back">
          <Icon name="i-lucide-arrow-left" class="w-3 h-3"/>
          Back
        </button>
        <div v-else class="w-5 shrink-0"></div>
        <div class="w-10 shrink-0"></div>
        <span class="flex-1">{{ viewMode === 'list' ? 'Name' : `${dm.folderCount.value} folders, ${dm.fileCount.value} files` }}</span>
        <span v-if="viewMode === 'list' && !dm.selected.value" class="w-16 text-right">Size</span>
        <span v-if="viewMode === 'list' && !dm.selected.value" class="w-24 text-right">Modified</span>
        <!-- List / Gallery toggle -->
        <div class="flex items-center rounded-lg overflow-hidden" :class="viewMode==='list' ? 'ml-auto' : ''" style="border:1px solid var(--border-subtle);background:var(--surface-elevated)">
          <button
            class="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold transition-all"
            :style="viewMode === 'list' ? {background:'var(--drive-green)',color:'#fff'} : {background:'transparent',color:'var(--text-tertiary)'}"
            title="List view" @click="setView('list')">
            <Icon name="i-lucide-list" class="w-3 h-3"/>List
          </button>
          <button
            class="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold transition-all"
            :style="viewMode === 'gallery' ? {background:'var(--drive-green)',color:'#fff'} : {background:'transparent',color:'var(--text-tertiary)'}"
            title="Gallery view" @click="setView('gallery')">
            <Icon name="i-lucide-layout-grid" class="w-3 h-3"/>Gallery
          </button>
        </div>
      </div>

      <!-- Bulk action bar -->
      <div v-if="isSelectMode" class="flex items-center gap-2 px-5 py-2 shrink-0" style="border-bottom:1px solid var(--border-subtle);background:var(--surface-elevated)">
        <span class="text-xs font-semibold" style="color:var(--text-primary)">{{selectedIds.size}} selected</span>
        <div class="flex-1"></div>
        <button class="btn-ghost" style="height:30px;font-size:12px" @click="startBulkMove()"><Icon name="i-lucide-folder-symlink" class="w-3.5 h-3.5" style="color:#8b5cf6"/>Move</button>
        <button class="btn-ghost" style="height:30px;font-size:12px" @click="bulkDownload()"><Icon name="i-lucide-download" class="w-3.5 h-3.5" style="color:#3b82f6"/>Download</button>
        <button class="flex items-center gap-1 h-[30px] px-3 rounded-lg text-xs font-semibold transition-all" style="background:rgba(239,68,68,0.1);color:#ef4444" @click="startBulkDelete()"><Icon name="i-lucide-trash-2" class="w-3.5 h-3.5"/>Delete</button>
        <button class="btn-icon" style="width:28px;height:28px" @click="clearSelection()"><Icon name="i-lucide-x" class="w-3.5 h-3.5"/></button>
      </div>

      <!-- Loading -->
      <div v-if="dm.loading.value" class="flex-1 overflow-auto">
        <!-- List skeleton -->
        <template v-if="viewMode==='list'">
          <div v-for="i in 8" :key="i" class="flex items-center gap-4 px-5 py-3.5" style="border-bottom:1px solid var(--border-subtle)">
            <div class="w-10 h-10 rounded-xl skeleton shrink-0"></div>
            <div class="flex-1 space-y-2"><div class="h-3.5 skeleton" :style="{width:`${40+Math.random()*40}%`}"></div><div class="h-2.5 skeleton w-1/4"></div></div>
          </div>
        </template>
        <!-- Gallery skeleton -->
        <div v-else class="p-4 grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
          <div v-for="i in 12" :key="i" class="rounded-2xl skeleton" style="aspect-ratio:1"></div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="dm.error.value" class="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <Icon name="i-lucide-cloud-off" class="w-12 h-12" style="color:var(--accent-red);opacity:0.5"/>
        <p class="text-sm" style="color:var(--text-secondary)">{{dm.error.value}}</p>
        <button class="btn-ghost" @click="dm.fetchFiles(dm.currentFolderId.value!)">Try again</button>
      </div>

      <!-- Empty -->
      <div v-else-if="dm.files.value.length===0" class="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <Icon name="i-lucide-folder-open" class="w-12 h-12" style="color:var(--text-tertiary);opacity:0.3"/>
        <p class="font-semibold" style="color:var(--text-primary)">No files yet</p>
        <p class="text-sm" style="color:var(--text-secondary)">Drag & drop or click Upload</p>
        <button class="btn-primary" @click="fileInputRef?.click()"><Icon name="i-lucide-upload" class="w-4 h-4"/>Upload Files</button>
      </div>

      <!-- File rows (LIST view) -->
      <div v-else-if="viewMode==='list'" class="flex-1 overflow-y-auto">
        <div v-for="f in dm.sorted.value" :key="f.id"
          :id="'file-item-'+f.id"
          class="group w-full flex items-center gap-3 px-5 py-3 text-left transition-all duration-150 cursor-pointer select-none"
          draggable="true"
          :style="{borderBottom:'1px solid var(--border-subtle)', background: dragOverId===f.id?'rgba(139,92,246,0.1)':selectedIds.has(f.id)?'rgba(29,164,98,0.08)':dm.selected.value?.id===f.id?'rgba(29,164,98,0.06)':'transparent', borderLeft: dragOverId===f.id?'3px solid #8b5cf6':selectedIds.has(f.id)?'3px solid #1da462':dm.selected.value?.id===f.id?'3px solid #1da462':'3px solid transparent'}"
          @click="dm.openFile(f)"
          @dragstart="onFileDragStart($event, f)"
          @dragend="onFileDragEnd()"
          @dragover="dm.isFolder(f) && onFolderDragOver($event, f.id)"
          @dragleave="dm.isFolder(f) && onFolderDragLeave()"
          @drop="dm.isFolder(f) && onFolderDrop($event, f)"
        >
          <!-- Checkbox -->
          <div class="w-5 h-5 rounded flex items-center justify-center cursor-pointer shrink-0" :style="{background: selectedIds.has(f.id)?'#1da462':'var(--surface-elevated)', border: '1.5px solid '+(selectedIds.has(f.id)?'#1da462':'var(--border-medium)'),'transition':'all 0.15s'}" @click.stop="toggleSelect(f)">
            <Icon v-if="selectedIds.has(f.id)" name="i-lucide-check" class="w-3 h-3 text-white"/>
          </div>
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105" :style="{background:dm.fileColor(f)+'15'}">
            <Icon v-if="dm.convertingFile.value?.id === f.id" name="i-lucide-loader-2" class="w-5 h-5 animate-spin" style="color:#10b981"/>
            <Icon v-else :name="dm.fileIcon(f)" class="w-5 h-5" :style="{color:dm.fileColor(f)}"/>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate" style="color:var(--text-primary)">{{f.name}}</p>
            <p v-if="dm.selected.value" class="text-[11px] mt-0.5" style="color:var(--text-tertiary)">
              <span v-if="f.size">{{dm.formatSize(f.size)}} · </span>{{dm.formatDate(f.modifiedTime)}}
            </p>
          </div>
          <span v-if="!dm.selected.value" class="w-16 text-right text-xs shrink-0" style="color:var(--text-tertiary)">{{dm.isFolder(f) ? '—' : dm.formatSize(f.size)}}</span>
          <span v-if="!dm.selected.value" class="w-24 text-right text-xs shrink-0" style="color:var(--text-tertiary)">{{dm.formatDate(f.modifiedTime)}}</span>
          <!-- Inline actions -->
          <div class="flex items-center gap-0.5 shrink-0" style="width:176px;justify-content:flex-end">
            <button v-if="!dm.isFolder(f)" class="btn-icon" style="width:28px;height:28px" title="Open in Drive" @click.stop="dm.openExternal(f)"><Icon name="i-lucide-external-link" class="w-3.5 h-3.5" style="color:#1da462"/></button>
            <button class="btn-icon" style="width:28px;height:28px" title="Rename" @click.stop="startRename(f)"><Icon name="i-lucide-pencil-line" class="w-3.5 h-3.5" style="color:#f59e0b"/></button>
            <button class="btn-icon" style="width:28px;height:28px" title="Move" @click.stop="startMove(f)"><Icon name="i-lucide-folder-symlink" class="w-3.5 h-3.5" style="color:#8b5cf6"/></button>
            <button v-if="!dm.isFolder(f)" class="btn-icon" style="width:28px;height:28px" title="Copy" @click.stop="doCopy(f)"><Icon name="i-lucide-copy" class="w-3.5 h-3.5" style="color:#6b7280"/></button>
            <button v-if="!dm.isFolder(f)" class="btn-icon" style="width:28px;height:28px" title="Download" @click.stop="dm.downloadFile(f)"><Icon name="i-lucide-download" class="w-3.5 h-3.5" style="color:#3b82f6"/></button>
            <button class="btn-icon" style="width:28px;height:28px" title="Delete" @click.stop="startDelete(f)"><Icon name="i-lucide-trash-2" class="w-3.5 h-3.5" style="color:#ef4444"/></button>
          </div>
        </div>
      </div>

      <!-- GALLERY VIEW -->
      <div v-else class="flex-1 overflow-y-auto p-4">
        <div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(148px,1fr))">
          <div v-for="f in dm.sorted.value" :key="f.id"
            :id="'file-item-'+f.id"
            class="group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 select-none"
            draggable="true"
            :style="{background:'var(--surface-card)', border: dragOverId===f.id?'2px solid #8b5cf6':selectedIds.has(f.id)?'2px solid #1da462':dm.selected.value?.id===f.id?'2px solid rgba(29,164,98,0.5)':'2px solid var(--border-subtle)', boxShadow: dragOverId===f.id?'0 0 0 3px rgba(139,92,246,0.25)':selectedIds.has(f.id)||dm.selected.value?.id===f.id?'0 0 0 2px rgba(29,164,98,0.2)':'none', transform:'translateZ(0)'}"
            @click="dm.openFile(f)"
            @dragstart="onFileDragStart($event, f)"
            @dragend="onFileDragEnd()"
            @dragover="dm.isFolder(f) && onFolderDragOver($event, f.id)"
            @dragleave="dm.isFolder(f) && onFolderDragLeave()"
            @drop="dm.isFolder(f) && onFolderDrop($event, f)"
          >
            <!-- Thumbnail area -->
            <div class="relative flex items-center justify-center overflow-hidden" style="aspect-ratio:1;background:var(--surface-elevated)">
              <!-- Real thumbnail for images -->
              <img v-if="f.thumbnailLink && dm.isImage(f)" :src="f.thumbnailLink" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" :alt="f.name" referrerpolicy="no-referrer"/>
              <!-- Google Workspace branded card (Sheets, Docs, Slides) -->
              <div v-else-if="dm.isGoogleWorkspace(f)" class="flex flex-col items-center justify-center gap-1.5 w-full h-full" :style="{background: dm.fileColor(f) + '12'}">
                <img v-if="f.thumbnailLink" :src="f.thumbnailLink" class="w-full h-full object-cover" :alt="f.name" referrerpolicy="no-referrer" @error="($event.target as HTMLImageElement).style.display='none'"/>
                <template v-if="!f.thumbnailLink">
                  <Icon :name="dm.fileIcon(f)" class="w-10 h-10" :style="{color: dm.fileColor(f)}"/>
                  <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" :style="{color: dm.fileColor(f), background: dm.fileColor(f) + '18'}">{{ dm.googleWorkspaceLabel(f).replace('Google ','') }}</span>
                </template>
              </div>
              <!-- Thumbnail from Drive for other files that have one -->
              <img v-else-if="f.thumbnailLink" :src="f.thumbnailLink" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" :alt="f.name" referrerpolicy="no-referrer" @error="($event.target as HTMLImageElement).parentElement!.innerHTML = ''"/>
              <!-- Icon fallback for non-images -->
              <div v-else class="flex flex-col items-center gap-2" :style="{background:dm.fileColor(f)+'10'}" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
                <Icon :name="dm.fileIcon(f)" class="w-14 h-14 transition-transform duration-200 group-hover:scale-110" :style="{color:dm.fileColor(f)}"/>
              </div>
              <!-- Select checkbox overlay -->
              <div class="absolute top-2 left-2 w-5 h-5 rounded-md flex items-center justify-center transition-all duration-150"
                :style="selectedIds.has(f.id) ? {background:'#1da462', border:'1.5px solid #1da462', opacity:1, backdropFilter:'blur(4px)'} : {background:'rgba(0,0,0,0.35)', border:'1.5px solid rgba(255,255,255,0.3)', opacity:0, backdropFilter:'blur(4px)'}"
                :class="{'opacity-0 group-hover:opacity-100': !selectedIds.has(f.id)}"
                @click.stop="toggleSelect(f)">
                <Icon name="i-lucide-check" class="w-3 h-3 text-white"/>
              </div>
              <!-- Hover action overlay -->
              <div class="absolute inset-0 flex items-end justify-center pb-2 gap-1 opacity-0 group-hover:opacity-100 transition-all duration-150" style="background:linear-gradient(to top,rgba(0,0,0,0.6) 0%,transparent 60%)">
                <button v-if="!dm.isFolder(f)" class="w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm" style="background:rgba(29,164,98,0.7)" title="Open in Drive" @click.stop="dm.openExternal(f)"><Icon name="i-lucide-external-link" class="w-3.5 h-3.5 text-white"/></button>
                <button class="w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm" style="background:rgba(255,255,255,0.15)" title="Rename" @click.stop="startRename(f)"><Icon name="i-lucide-pencil-line" class="w-3.5 h-3.5 text-white"/></button>
                <button v-if="!dm.isFolder(f)" class="w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm" style="background:rgba(255,255,255,0.15)" title="Download" @click.stop="dm.downloadFile(f)"><Icon name="i-lucide-download" class="w-3.5 h-3.5 text-white"/></button>
                <button class="w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm" style="background:rgba(239,68,68,0.7)" title="Delete" @click.stop="startDelete(f)"><Icon name="i-lucide-trash-2" class="w-3.5 h-3.5 text-white"/></button>
              </div>
            </div>
            <!-- File name + meta -->
            <div class="px-2.5 py-2">
              <p class="text-[11px] font-semibold truncate leading-tight" style="color:var(--text-primary)">{{f.name}}</p>
              <p class="text-[10px] mt-0.5" style="color:var(--text-tertiary)">{{dm.isFolder(f)?'Folder':dm.formatSize(f.size)||dm.formatDate(f.modifiedTime)}}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- PREVIEW PANEL -->
    <div v-if="dm.selected.value" class="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden" style="background:var(--surface-elevated)">
      <div class="flex items-center gap-3 px-5 py-2.5 shrink-0" style="border-bottom:1px solid var(--border-subtle);background:var(--surface-card)">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :style="{background:dm.fileColor(dm.selected.value)+'15'}">
          <Icon :name="dm.fileIcon(dm.selected.value)" class="w-4 h-4" :style="{color:dm.fileColor(dm.selected.value)}"/>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate" style="color:var(--text-primary)">{{dm.selected.value.name}}</p>
          <p class="text-[11px]" style="color:var(--text-tertiary)">{{dm.formatSize(dm.selected.value.size)}} · {{dm.formatDate(dm.selected.value.modifiedTime)}}</p>
        </div>
        <!-- Position counter -->
        <span v-if="dm.sorted.value.length > 1" class="text-[11px] font-medium tabular-nums shrink-0" style="color:var(--text-tertiary)">{{ selectedIndex + 1 }} / {{ dm.sorted.value.length }}</span>
        <button class="btn-ghost" @click="startRename(dm.selected.value)"><Icon name="i-lucide-pencil-line" class="w-3 h-3"/>Rename</button>
        <button class="btn-ghost" @click="dm.openExternal(dm.selected.value)"><Icon name="i-lucide-external-link" class="w-3 h-3"/>Open in Drive</button>
        <button v-if="!dm.isFolder(dm.selected.value) && !dm.isGoogleWorkspace(dm.selected.value)" class="btn-ghost" @click="dm.downloadFile(dm.selected.value)"><Icon name="i-lucide-download" class="w-3 h-3"/>Download</button>
        <!-- Keyboard nav hint -->
        <div class="hidden sm:flex items-center gap-0.5 px-2 py-1 rounded-lg" style="background:var(--surface-elevated);border:1px solid var(--border-subtle)" title="Use arrow keys to navigate">
          <Icon name="i-lucide-arrow-left" class="w-2.5 h-2.5" style="color:var(--text-tertiary)"/>
          <Icon name="i-lucide-arrow-right" class="w-2.5 h-2.5" style="color:var(--text-tertiary)"/>
          <span class="text-[10px] font-medium ml-0.5" style="color:var(--text-tertiary)">Navigate</span>
        </div>
        <button class="btn-icon" @click="dm.selected.value=null"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
      </div>
      <div class="relative flex-1 min-h-0 overflow-hidden">
        <!-- Prev / Next overlay arrows -->
        <button v-if="prevFile" @click="navigatePrev()"
          class="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110"
          style="background:rgba(0,0,0,0.45);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.12);color:#fff"
          title="Previous (←)">
          <Icon name="i-lucide-chevron-left" class="w-5 h-5"/>
        </button>
        <button v-if="nextFile" @click="navigateNext()"
          class="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110"
          style="background:rgba(0,0,0,0.45);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.12);color:#fff"
          title="Next (→)">
          <Icon name="i-lucide-chevron-right" class="w-5 h-5"/>
        </button>
        <!-- Video player -->
        <div v-if="dm.isVideo(dm.selected.value)" class="flex items-center justify-center h-full p-4" style="background:#000">
          <video controls autoplay class="max-w-full max-h-full rounded-lg" :src="dm.streamUrl(dm.selected.value)" :key="dm.selected.value.id"></video>
        </div>
        <!-- Audio player -->
        <div v-else-if="dm.isAudio(dm.selected.value)" class="flex flex-col items-center justify-center h-full gap-6 p-12">
          <div class="w-28 h-28 rounded-3xl flex items-center justify-center" style="background:rgba(6,182,212,0.1)">
            <Icon name="i-lucide-music" class="w-14 h-14" style="color:#06b6d4"/>
          </div>
          <p class="text-sm font-semibold truncate max-w-full" style="color:var(--text-primary)">{{dm.selected.value.name}}</p>
          <audio controls class="w-full max-w-md" style="border-radius:12px" :src="dm.streamUrl(dm.selected.value)" :key="dm.selected.value.id"></audio>
        </div>
        <!-- Archive info -->
        <div v-else-if="dm.isArchive(dm.selected.value)" class="flex flex-col items-center justify-center h-full gap-4 p-12 text-center">
          <div class="w-20 h-20 rounded-3xl flex items-center justify-center" style="background:rgba(120,113,108,0.1)">
            <Icon name="i-lucide-archive" class="w-10 h-10" style="color:#78716c"/>
          </div>
          <p class="font-semibold" style="color:var(--text-primary)">Archive File</p>
          <p class="text-sm" style="color:var(--text-secondary)">{{dm.formatSize(dm.selected.value.size)}} · {{dm.selected.value.name.split('.').pop()?.toUpperCase()}}</p>
          <button class="btn-primary" @click="dm.downloadFile(dm.selected.value!)"><Icon name="i-lucide-download" class="w-4 h-4"/>Download</button>
        </div>
        <!-- Google Workspace files (Docs, Sheets, Slides) — open directly in the browser -->
        <div v-else-if="dm.isGoogleWorkspace(dm.selected.value)" class="flex flex-col items-center justify-center h-full gap-5 p-12 text-center">
          <div class="w-24 h-24 rounded-3xl flex items-center justify-center" :style="{background:dm.fileColor(dm.selected.value)+'18'}">
            <Icon :name="dm.fileIcon(dm.selected.value)" class="w-12 h-12" :style="{color:dm.fileColor(dm.selected.value)}"/>
          </div>
          <div>
            <p class="font-bold text-base" style="color:var(--text-primary)">{{dm.selected.value.name}}</p>
            <p class="text-xs mt-1" style="color:var(--text-tertiary)">{{dm.googleWorkspaceLabel(dm.selected.value)}}</p>
          </div>
          <div class="flex flex-col gap-2 w-full max-w-[240px]">
            <button class="btn-primary w-full justify-center" :style="{background:'linear-gradient(135deg,'+dm.fileColor(dm.selected.value)+','+dm.fileColor(dm.selected.value)+'cc)'}" @click="dm.openExternal(dm.selected.value)">
              <Icon name="i-lucide-external-link" class="w-4 h-4"/>
              Open in {{dm.googleWorkspaceLabel(dm.selected.value)}}
            </button>
            <p class="text-[11px]" style="color:var(--text-tertiary)">Opens in a new tab in your browser</p>
          </div>
        </div>
        <!-- Office files (Excel, Word, PowerPoint) — preview via Google Drive viewer -->
        <div v-else-if="dm.isOfficeFile(dm.selected.value)" class="relative w-full h-full flex flex-col">
          <div class="flex items-center gap-2 px-4 py-2 shrink-0" style="background:var(--surface-card);border-bottom:1px solid var(--border-subtle)">
            <Icon :name="dm.fileIcon(dm.selected.value)" class="w-3.5 h-3.5" :style="{color:dm.fileColor(dm.selected.value)}"/>
            <span class="text-[11px] font-medium flex-1" style="color:var(--text-secondary)">Previewing via Google Drive Viewer</span>
            <button class="btn-ghost" style="height:26px;font-size:11px;padding:0 10px" @click="dm.openExternal(dm.selected.value)">
              <Icon name="i-lucide-external-link" class="w-3 h-3"/>Open in Drive
            </button>
          </div>
          <iframe :key="dm.selected.value.id"
            :src="dm.previewUrl(dm.selected.value)"
            class="flex-1 w-full border-0"
            allow="autoplay; clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"/>
        </div>
        <!-- Fast image preview (direct img — much faster than iframe) -->
        <div v-else-if="dm.isImage(dm.selected.value)" class="relative w-full h-full flex items-center justify-center" style="background:#0a0a0a">
          <img
            :key="dm.selected.value.id"
            :src="dm.selected.value.thumbnailLink ? dm.selected.value.thumbnailLink.replace(/=s\d+/, '=s2000') : dm.streamUrl(dm.selected.value)"
            :alt="dm.selected.value.name"
            class="max-w-full max-h-full object-contain"
            style="border-radius:4px"
            referrerpolicy="no-referrer"
            @error="($event.target as HTMLImageElement).src = dm.streamUrl(dm.selected.value)"
          />
        </div>
        <!-- Google Drive iframe preview (PDF + other previewable files) -->
        <div v-else-if="dm.canPreview(dm.selected.value)" class="relative w-full h-full">
          <iframe :key="dm.selected.value.id" :src="dm.previewUrl(dm.selected.value)" class="w-full h-full border-0"
            allow="autoplay; clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"/>
          <!-- Cover Google Drive's "open in new tab" icon -->
          <div style="position:absolute;top:0;right:0;width:56px;height:56px;background:var(--surface-elevated);z-index:10;pointer-events:all"></div>
        </div>
        <!-- Fallback -->
        <div v-else class="flex flex-col items-center justify-center h-full gap-4 p-12 text-center">
          <div class="w-20 h-20 rounded-3xl flex items-center justify-center" :style="{background:dm.fileColor(dm.selected.value)+'15'}">
            <Icon :name="dm.fileIcon(dm.selected.value)" class="w-10 h-10" :style="{color:dm.fileColor(dm.selected.value)}"/>
          </div>
          <p class="font-semibold" style="color:var(--text-primary)">No preview available</p>
          <p class="text-xs" style="color:var(--text-tertiary)">{{dm.selected.value.mimeType}}</p>
          <button class="btn-primary" @click="dm.downloadFile(dm.selected.value!)"><Icon name="i-lucide-download" class="w-4 h-4"/>Download to view</button>
        </div>
      </div>
    </div>
  </div>

  <!-- CREATE GOOGLE DOC/SHEET MODAL -->
  <div v-if="showCreateGdoc" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.55);backdrop-filter:blur(6px)" @click.self="showCreateGdoc=false">
    <div class="w-full max-w-sm mx-4 rounded-2xl overflow-hidden" style="background:var(--surface-card);border:1px solid var(--border-subtle);box-shadow:0 20px 60px rgba(0,0,0,0.5)">
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-4" :style="{background: GDOC_TYPES.find(t=>t.type===createGdocType)?.bg}">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" :style="{background: GDOC_TYPES.find(t=>t.type===createGdocType)?.bg}">
          <Icon :name="GDOC_TYPES.find(t=>t.type===createGdocType)?.icon||'i-lucide-file'" class="w-5 h-5" :style="{color: GDOC_TYPES.find(t=>t.type===createGdocType)?.color}"/>
        </div>
        <div>
          <p class="text-sm font-bold" style="color:var(--text-primary)">Create {{GDOC_TYPES.find(t=>t.type===createGdocType)?.label}}</p>
          <p class="text-[11px]" style="color:var(--text-tertiary)">In current folder · Opens in new tab after creation</p>
        </div>
      </div>
      <div class="px-5 py-4 space-y-4">
        <!-- Type switcher -->
        <div class="flex gap-1.5">
          <button v-for="gt in GDOC_TYPES" :key="gt.type"
            class="flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[11px] font-semibold transition-all"
            :style="{background: createGdocType===gt.type ? gt.bg : 'var(--surface-elevated)', border: '1.5px solid '+(createGdocType===gt.type ? gt.color+'60' : 'transparent'), color: createGdocType===gt.type ? gt.color : 'var(--text-tertiary)'}"
            @click="createGdocType=gt.type">
            <Icon :name="gt.icon" class="w-4 h-4"/>
            <span>{{gt.label.replace('Google ','')}}</span>
          </button>
        </div>
        <!-- Name input -->
        <div>
          <label class="text-[11px] font-medium block mb-1.5" style="color:var(--text-secondary)">File name</label>
          <input v-model="createGdocName" class="input-base w-full" style="height:40px" :placeholder="'Untitled '+GDOC_TYPES.find(t=>t.type===createGdocType)?.label.replace('Google ','')" @keydown.enter="confirmCreateGdoc" @keydown.escape="showCreateGdoc=false" autofocus/>
        </div>
        <!-- Actions -->
        <div class="flex gap-2 pt-1">
          <button class="btn-ghost flex-1 justify-center" @click="showCreateGdoc=false">Cancel</button>
          <button class="btn-primary flex-1 justify-center" :disabled="!createGdocName.trim()||createGdocLoading" :style="{background: 'linear-gradient(135deg,'+(GDOC_TYPES.find(t=>t.type===createGdocType)?.color||'#1da462')+','+(GDOC_TYPES.find(t=>t.type===createGdocType)?.color||'#1da462')+'cc)'}" @click="confirmCreateGdoc">
            <Icon :name="createGdocLoading?'i-lucide-loader-2':'i-lucide-plus'" class="w-4 h-4" :class="{'animate-spin':createGdocLoading}"/>
            Create & Open
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- DELETE CONFIRMATION MODAL -->
  <div v-if="deletingFiles.length" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" @click.self="deletingFiles=[]">
    <div class="w-full max-w-sm mx-4 p-5 rounded-2xl" style="background:var(--surface-card);border:1px solid var(--border-subtle)">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:rgba(239,68,68,0.1)">
          <Icon name="i-lucide-trash-2" class="w-5 h-5" style="color:#ef4444"/>
        </div>
        <div>
          <p class="text-sm font-semibold" style="color:var(--text-primary)">Delete {{deletingFiles.length > 1 ? `${deletingFiles.length} items` : 'file'}}?</p>
          <p class="text-xs" style="color:var(--text-tertiary)">Items will be moved to the _Archive folder</p>
        </div>
      </div>
      <p v-if="deletingFiles.length===1" class="text-sm mb-4 px-1 truncate" style="color:var(--text-secondary)">"{{deletingFiles[0]!.name}}"</p>
      <p v-else class="text-sm mb-4 px-1" style="color:var(--text-secondary)">{{deletingFiles.length}} files and folders selected</p>
      <div class="flex gap-2 justify-end">
        <button class="btn-ghost" @click="deletingFiles=[]">Cancel</button>
        <button class="flex items-center gap-1.5 h-9 px-4 rounded-xl text-sm font-semibold transition-all" style="background:rgba(239,68,68,0.15);color:#ef4444" :disabled="deleteLoading" @click="confirmDelete()">
          <Icon :name="deleteLoading?'i-lucide-loader-2':'i-lucide-trash-2'" class="w-3.5 h-3.5" :class="{'animate-spin':deleteLoading}"/>
          Delete
        </button>
      </div>
    </div>
  </div>

  <!-- UPLOAD PROGRESS OVERLAY -->
  <transition enter-active-class="transition-all duration-300" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-active-class="transition-all duration-300" leave-from-class="opacity-100" leave-to-class="opacity-0 translate-y-4">
    <div v-if="isUploading" class="fixed bottom-6 right-6 z-[998] w-80 rounded-2xl overflow-hidden" style="background:var(--surface-card);border:1px solid var(--border-medium);box-shadow:0 12px 40px rgba(0,0,0,0.5)">
      <div class="px-4 py-3">
        <div class="flex items-center gap-2.5 mb-2">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:rgba(29,164,98,0.1)">
            <Icon name="i-lucide-upload-cloud" class="w-4 h-4 animate-pulse" style="color:#1da462"/>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold" style="color:var(--text-primary)">Uploading files…</p>
            <p class="text-[11px] truncate" style="color:var(--text-tertiary)">{{ uploadCurrentName }}</p>
          </div>
          <span class="text-sm font-bold tabular-nums" style="color:#1da462">{{ uploadProgress }}%</span>
        </div>
        <!-- Progress bar -->
        <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--surface-elevated)">
          <div class="h-full rounded-full transition-all duration-500 ease-out" :style="{width: uploadProgress+'%', background:'linear-gradient(90deg, #1da462, #34a853)'}"></div>
        </div>
        <p class="text-[11px] mt-1.5 tabular-nums" style="color:var(--text-tertiary)">{{ uploadCurrent }} of {{ uploadTotal }} files</p>
      </div>
    </div>
  </transition>

  <!-- FOOTER -->
  <div class="flex items-center justify-between px-5 py-2 shrink-0" style="border-top:1px solid var(--border-subtle);background:var(--surface-card)">
    <div class="flex items-center gap-3 text-xs" style="color:var(--text-tertiary)">
      <div class="flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full" style="background:#1da462"></div>Google Drive</div>
      <span v-if="dm.files.value.length">{{dm.folderCount.value}} folders, {{dm.fileCount.value}} files · {{totalSizeFormatted}}</span>
    </div>
  </div>
</div>
</template>
