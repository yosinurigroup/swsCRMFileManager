const FOLDER_MIME = 'application/vnd.google-apps.folder'
const IMAGE_MIMES = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
const VIDEO_MIMES = ['video/mp4','video/webm','video/quicktime']
const PREVIEWABLE = [...IMAGE_MIMES,...VIDEO_MIMES,'application/pdf','application/vnd.google-apps.document','application/vnd.google-apps.spreadsheet','application/vnd.google-apps.presentation']

export interface DriveFile {
  id: string; name: string; mimeType: string; size?: string
  modifiedTime?: string; thumbnailLink?: string; iconLink?: string; webViewLink?: string
}

export function useDriveManager(rootId: Ref<string>) {
  const folderStack = ref<{id:string,name:string}[]>([])
  const files = ref<DriveFile[]>([])
  const loading = ref(false)
  const error = ref('')
  const selected = ref<DriveFile|null>(null)
  const previewLoaded = ref(false)

  const currentFolderId = computed(() =>
    folderStack.value.length > 0 ? folderStack.value[folderStack.value.length-1]!.id : rootId.value
  )
  // Hide _Archive folder from UI
  const visibleFiles = computed(() => files.value.filter(f => f.name !== '_Archive'))
  const sorted = computed(() => {
    const f = visibleFiles.value.filter(f => f.mimeType === FOLDER_MIME)
    const r = visibleFiles.value.filter(f => f.mimeType !== FOLDER_MIME)
    return [...f,...r]
  })
  const folderCount = computed(() => visibleFiles.value.filter(f=>f.mimeType===FOLDER_MIME).length)
  const fileCount = computed(() => visibleFiles.value.filter(f=>f.mimeType!==FOLDER_MIME).length)
  const rootFolderName = ref('')

  async function fetchRootName(fid: string) {
    try {
      const d = await $fetch<{success:boolean,files:DriveFile[],folderName?:string}>(`/api/drive/files?folderId=${fid}`)
      if (d.folderName) rootFolderName.value = d.folderName
    } catch {}
  }

  async function fetchFiles(fid: string) {
    loading.value = true; error.value = ''; files.value = []
    try {
      const d = await $fetch<{success:boolean,files:DriveFile[],folderName?:string}>(`/api/drive/files?folderId=${fid}`)
      files.value = d.files || []
      if (fid === rootId.value && d.folderName) rootFolderName.value = d.folderName
    } catch(e:any) { error.value = e.data?.statusMessage || 'Failed to load files' }
    finally { loading.value = false }
  }

  function openFolder(f: DriveFile) { selected.value = null; folderStack.value.push({id:f.id,name:f.name}) }
  function goBack() { selected.value = null; folderStack.value.pop() }
  function goToRoot() { selected.value = null; folderStack.value = [] }
  function goToBreadcrumb(i: number) { selected.value = null; folderStack.value = folderStack.value.slice(0,i+1) }

  function openFile(f: DriveFile) {
    if (f.mimeType === FOLDER_MIME) { openFolder(f); return }
    previewLoaded.value = false; selected.value = f
  }

  function previewUrl(f: DriveFile): string {
    if (f.mimeType==='application/vnd.google-apps.document') return `https://docs.google.com/document/d/${f.id}/preview`
    if (f.mimeType==='application/vnd.google-apps.spreadsheet') return `https://docs.google.com/spreadsheets/d/${f.id}/preview`
    if (f.mimeType==='application/vnd.google-apps.presentation') return `https://docs.google.com/presentation/d/${f.id}/preview`
    return `https://drive.google.com/file/d/${f.id}/preview`
  }

  function canPreview(f: DriveFile) { return PREVIEWABLE.includes(f.mimeType) }
  function isFolder(f: DriveFile) { return f.mimeType === FOLDER_MIME }
  function isImage(f: DriveFile) { return IMAGE_MIMES.includes(f.mimeType) }

  function downloadFile(f: DriveFile) {
    const a = document.createElement('a'); a.href = `/api/drive/download?fileId=${f.id}`; a.download = f.name; a.click()
  }
  function openExternal(f: DriveFile) {
    window.open(f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`, '_blank')
  }
  function openInDrive() {
    const base = currentFolderId.value ? `https://drive.google.com/drive/folders/${currentFolderId.value}` : ''
    window.open(base, '_blank')
  }

  async function renameFile(fid: string, name: string) {
    await $fetch('/api/drive/rename', { method:'PATCH', body:{fileId:fid, name} })
    const idx = files.value.findIndex(f=>f.id===fid)
    if (idx>=0) files.value[idx] = {...files.value[idx]!, name}
    const si = folderStack.value.findIndex(s=>s.id===fid)
    if (si>=0) folderStack.value[si] = {...folderStack.value[si]!, name}
  }

  async function createFolder(name: string) {
    const r = await $fetch<{success:boolean,folder:DriveFile}>('/api/drive/create-folder', {
      method:'POST', body:{parentId:currentFolderId.value, name}
    })
    await fetchFiles(currentFolderId.value!)
    return r.folder
  }

  async function moveFile(fileId: string, newParentId: string) {
    await $fetch('/api/drive/move', {
      method:'PATCH', body:{fileId, newParentId, oldParentId: currentFolderId.value}
    })
    files.value = files.value.filter(f=>f.id!==fileId)
    if (selected.value?.id===fileId) selected.value = null
  }

  async function copyFile(fileId: string) {
    const r = await $fetch<{success:boolean,file:DriveFile}>('/api/drive/copy', {method:'POST',body:{fileId}})
    await fetchFiles(currentFolderId.value!)
    return r.file
  }

  async function deleteFile(fileId: string) {
    await $fetch('/api/drive/archive', {method:'POST',body:{fileId, rootFolderId: rootId.value}})
    files.value = files.value.filter(f=>f.id!==fileId)
    if (selected.value?.id===fileId) selected.value = null
  }

  async function uploadFiles(fileList: File[], relativePaths: string[]) {
    if (!currentFolderId.value || fileList.length===0) return
    const fd = new FormData()
    fd.append('folderId', currentFolderId.value)
    fileList.forEach(f => fd.append('files', f))
    fd.append('relativePaths', JSON.stringify(relativePaths))
    const r = await $fetch<{success:boolean,count:number}>('/api/drive/upload', {method:'POST',body:fd})
    await fetchFiles(currentFolderId.value!)
    return r.count
  }

  watch(currentFolderId, id => { if(id) fetchFiles(id) })

  function fileIcon(f: DriveFile) {
    if (isFolder(f)) return 'i-lucide-folder'
    if (f.mimeType==='application/pdf') return 'i-lucide-file-text'
    if (IMAGE_MIMES.includes(f.mimeType)) return 'i-lucide-image'
    if (VIDEO_MIMES.includes(f.mimeType)) return 'i-lucide-video'
    if (f.mimeType?.includes('spreadsheet')) return 'i-lucide-table'
    if (f.mimeType?.includes('document')) return 'i-lucide-file-text'
    if (f.mimeType?.includes('presentation')) return 'i-lucide-presentation'
    return 'i-lucide-file'
  }
  function fileColor(f: DriveFile) {
    if (isFolder(f)) return '#f59e0b'
    if (f.mimeType==='application/pdf') return '#ef4444'
    if (IMAGE_MIMES.includes(f.mimeType)) return '#8b5cf6'
    if (VIDEO_MIMES.includes(f.mimeType)) return '#ec4899'
    if (f.mimeType?.includes('spreadsheet')) return '#10b981'
    if (f.mimeType?.includes('document')) return '#3b82f6'
    if (f.mimeType?.includes('presentation')) return '#f97316'
    return '#6b7280'
  }
  function formatSize(s?: string) {
    if (!s) return ''
    const n = parseInt(s)
    if (n<1024) return `${n} B`
    if (n<1024*1024) return `${(n/1024).toFixed(1)} KB`
    return `${(n/1024/1024).toFixed(1)} MB`
  }
  function formatDate(d?: string) {
    if (!d) return ''
    return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  }

  return {
    folderStack, files, loading, error, selected, previewLoaded, rootFolderName,
    currentFolderId, sorted, folderCount, fileCount,
    fetchFiles, openFolder, goBack, goToRoot, goToBreadcrumb, openFile,
    previewUrl, canPreview, isFolder, isImage, downloadFile, openExternal, openInDrive,
    renameFile, createFolder, moveFile, copyFile, deleteFile, uploadFiles,
    fileIcon, fileColor, formatSize, formatDate
  }
}
