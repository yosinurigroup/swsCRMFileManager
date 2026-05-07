<script setup lang="ts">
import type { DriveFile } from '~/composables/useDriveManager'

const route = useRoute()
const rootId = computed(() => route.params.folderId as string)
const dm = useDriveManager(rootId)

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
let dragCounter = 0

// Rename state
const renamingFile = ref<DriveFile|null>(null)
const renameValue = ref('')
const renameLoading = ref(false)

// New folder state
const showNewFolder = ref(false)
const newFolderName = ref('')
const newFolderLoading = ref(false)

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

onMounted(() => { if(rootId.value) dm.fetchFiles(rootId.value) })

useHead({ title: 'File Manager — SWS Drive' })

// Upload handlers
function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  if(input.files?.length) doUpload(Array.from(input.files), [])
  input.value = ''
}
async function doUpload(files: File[], paths: string[]) {
  isUploading.value = true
  uploadTotal.value = files.length
  uploadCurrent.value = 0
  uploadProgress.value = 0
  try {
    // Upload files one by one for progress tracking
    const folderId = dm.currentFolderId.value
    if (!folderId) return
    for (let i = 0; i < files.length; i++) {
      uploadCurrent.value = i + 1
      uploadCurrentName.value = files[i]!.name
      uploadProgress.value = Math.round(((i) / files.length) * 100)
      const fd = new FormData()
      fd.append('folderId', folderId)
      fd.append('files', files[i]!)
      fd.append('relativePaths', JSON.stringify([paths[i] || files[i]!.name]))
      await $fetch('/api/drive/upload', { method: 'POST', body: fd })
    }
    uploadProgress.value = 100
    await dm.fetchFiles(folderId)
    showToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`)
  } catch {}
  finally {
    setTimeout(() => { isUploading.value = false; uploadProgress.value = 0 }, 600)
  }
}
function onDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; isDragging.value = true }
function onDragLeave(e: DragEvent) { e.preventDefault(); dragCounter--; if(dragCounter<=0){isDragging.value=false;dragCounter=0} }
function onDragOver(e: DragEvent) { e.preventDefault() }
async function onDrop(e: DragEvent) {
  e.preventDefault(); isDragging.value = false; dragCounter = 0
  if(!e.dataTransfer) return
  const files = Array.from(e.dataTransfer.files)
  if(files.length) doUpload(files, files.map(f=>f.name))
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
    movePickerFiles.value = (d.files||[]).filter(f => f.mimeType === 'application/vnd.google-apps.folder' && f.id !== movingFile.value?.id && f.name !== '_Archive')
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
      <button class="text-sm font-bold shrink-0" style="color:var(--text-primary)" @click="dm.goToRoot()">{{dm.rootFolderName.value || 'Files'}}</button>
      <template v-for="(c,i) in dm.folderStack.value" :key="c.id">
        <Icon name="i-lucide-chevron-right" class="w-3.5 h-3.5 shrink-0" style="color:var(--text-tertiary)"/>
        <button class="text-sm truncate max-w-[180px] shrink-0" :style="{color: i===dm.folderStack.value.length-1?'var(--text-primary)':'var(--text-secondary)', fontWeight: i===dm.folderStack.value.length-1?'600':'400'}" @click="dm.goToBreadcrumb(i)">{{c.name}}</button>
      </template>
    </div>
    <!-- Total size -->
    <span class="text-xs font-medium shrink-0 tabular-nums" style="color:var(--text-tertiary)">{{totalSizeFormatted}}</span>
    <!-- Actions -->
    <div class="flex items-center gap-2 shrink-0">
      <button v-if="dm.folderStack.value.length>0" class="btn-ghost" @click="dm.goBack()"><Icon name="i-lucide-arrow-left" class="w-3.5 h-3.5"/>Back</button>
      <button class="btn-icon" @click="dm.fetchFiles(dm.currentFolderId.value!)"><Icon name="i-lucide-refresh-cw" class="w-4 h-4" :class="{'animate-spin':dm.loading.value}"/></button>
      <button class="btn-ghost" @click="showNewFolder=true"><Icon name="i-lucide-folder-plus" class="w-3.5 h-3.5"/>New Folder</button>
      <button class="btn-primary" :disabled="isUploading" @click="fileInputRef?.click()">
        <Icon :name="isUploading?'i-lucide-loader-2':'i-lucide-upload'" class="w-4 h-4" :class="{'animate-spin':isUploading}"/>Upload
      </button>
      <input ref="fileInputRef" type="file" multiple class="hidden" @change="onFileInput">

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
      <p class="text-lg font-bold" style="color:#1da462">Drop files here</p>
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
    <div class="flex flex-col min-h-0 overflow-hidden transition-all duration-300" :style="{width: dm.selected.value?'380px':'100%', minWidth: dm.selected.value?'380px':'0', borderRight: dm.selected.value?'1px solid var(--border-subtle)':'none'}">
      <!-- Column header -->
      <div class="flex items-center gap-3 px-5 py-2 shrink-0 text-xs font-medium uppercase tracking-wider" style="color:var(--text-tertiary);border-bottom:1px solid var(--border-subtle);background:var(--surface-card)">
        <div class="w-5 shrink-0"></div>
        <div class="w-10 shrink-0"></div>
        <span class="flex-1">Name</span>
        <span v-if="!dm.selected.value" class="w-16 text-right">Size</span>
        <span v-if="!dm.selected.value" class="w-24 text-right">Modified</span>
        <div class="shrink-0" style="width:148px">Actions</div>
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
        <div v-for="i in 8" :key="i" class="flex items-center gap-4 px-5 py-3.5" style="border-bottom:1px solid var(--border-subtle)">
          <div class="w-10 h-10 rounded-xl skeleton shrink-0"></div>
          <div class="flex-1 space-y-2"><div class="h-3.5 skeleton" :style="{width:`${40+Math.random()*40}%`}"></div><div class="h-2.5 skeleton w-1/4"></div></div>
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

      <!-- File rows -->
      <div v-else class="flex-1 overflow-y-auto">
        <button v-for="f in dm.sorted.value" :key="f.id"
          class="group w-full flex items-center gap-3 px-5 py-3 text-left transition-all duration-150"
          :style="{borderBottom:'1px solid var(--border-subtle)', background: selectedIds.has(f.id)?'rgba(29,164,98,0.08)':dm.selected.value?.id===f.id?'rgba(29,164,98,0.06)':'transparent', borderLeft: selectedIds.has(f.id)?'3px solid #1da462':dm.selected.value?.id===f.id?'3px solid #1da462':'3px solid transparent'}"
          @click="dm.openFile(f)"
        >
          <!-- Checkbox -->
          <div class="w-5 h-5 rounded flex items-center justify-center cursor-pointer shrink-0" :style="{background: selectedIds.has(f.id)?'#1da462':'var(--surface-elevated)', border: '1.5px solid '+(selectedIds.has(f.id)?'#1da462':'var(--border-medium)'),'transition':'all 0.15s'}" @click.stop="toggleSelect(f)">
            <Icon v-if="selectedIds.has(f.id)" name="i-lucide-check" class="w-3 h-3 text-white"/>
          </div>
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105" :style="{background:dm.fileColor(f)+'15'}">
            <Icon :name="dm.fileIcon(f)" class="w-5 h-5" :style="{color:dm.fileColor(f)}"/>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate" style="color:var(--text-primary)">{{f.name}}</p>
            <p v-if="dm.selected.value" class="text-[11px] mt-0.5" style="color:var(--text-tertiary)">
              <span v-if="f.size">{{dm.formatSize(f.size)}} · </span>{{dm.formatDate(f.modifiedTime)}}
            </p>
          </div>
          <span v-if="!dm.selected.value" class="w-16 text-right text-xs shrink-0" style="color:var(--text-tertiary)">{{dm.isFolder(f) ? '—' : dm.formatSize(f.size)}}</span>
          <span v-if="!dm.selected.value" class="w-24 text-right text-xs shrink-0" style="color:var(--text-tertiary)">{{dm.formatDate(f.modifiedTime)}}</span>
          <!-- Inline actions (always visible) -->
          <div class="flex items-center gap-0.5 shrink-0">
            <button class="btn-icon" style="width:28px;height:28px" title="Rename" @click.stop="startRename(f)"><Icon name="i-lucide-pencil-line" class="w-3.5 h-3.5" style="color:#f59e0b"/></button>
            <button class="btn-icon" style="width:28px;height:28px" title="Move" @click.stop="startMove(f)"><Icon name="i-lucide-folder-symlink" class="w-3.5 h-3.5" style="color:#8b5cf6"/></button>
            <button v-if="!dm.isFolder(f)" class="btn-icon" style="width:28px;height:28px" title="Copy" @click.stop="doCopy(f)"><Icon name="i-lucide-copy" class="w-3.5 h-3.5" style="color:#6b7280"/></button>
            <button v-if="!dm.isFolder(f)" class="btn-icon" style="width:28px;height:28px" title="Download" @click.stop="dm.downloadFile(f)"><Icon name="i-lucide-download" class="w-3.5 h-3.5" style="color:#3b82f6"/></button>
            <button class="btn-icon" style="width:28px;height:28px" title="Delete" @click.stop="startDelete(f)"><Icon name="i-lucide-trash-2" class="w-3.5 h-3.5" style="color:#ef4444"/></button>
          </div>
        </button>
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
        <button class="btn-ghost" @click="startRename(dm.selected.value)"><Icon name="i-lucide-pencil-line" class="w-3 h-3"/>Rename</button>
        <button class="btn-ghost" @click="dm.downloadFile(dm.selected.value)"><Icon name="i-lucide-download" class="w-3 h-3"/>Download</button>
        <button class="btn-icon" @click="dm.selected.value=null"><Icon name="i-lucide-x" class="w-4 h-4"/></button>
      </div>
      <div class="relative flex-1 min-h-0 overflow-hidden">
        <!-- Audio player -->
        <div v-if="dm.isAudio(dm.selected.value)" class="flex flex-col items-center justify-center h-full gap-6 p-12">
          <div class="w-28 h-28 rounded-3xl flex items-center justify-center" style="background:rgba(6,182,212,0.1)">
            <Icon name="i-lucide-music" class="w-14 h-14" style="color:#06b6d4"/>
          </div>
          <p class="text-sm font-semibold truncate max-w-full" style="color:var(--text-primary)">{{dm.selected.value.name}}</p>
          <audio controls class="w-full max-w-md" style="border-radius:12px" :src="`/api/drive/download?fileId=${dm.selected.value.id}`"></audio>
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
        <!-- Google Drive iframe preview (PDF, Office, images, video, etc.) -->
        <iframe v-else-if="dm.canPreview(dm.selected.value)" :key="dm.selected.value.id" :src="dm.previewUrl(dm.selected.value)" class="w-full h-full border-0" allow="autoplay" sandbox="allow-scripts allow-same-origin"/>
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
