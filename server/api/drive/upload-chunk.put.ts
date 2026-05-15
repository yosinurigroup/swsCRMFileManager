/**
 * Proxy a chunk upload to Google Drive's resumable upload endpoint.
 * This is the fallback for when CORS prevents direct browser-to-Google uploads.
 * 
 * The client sends the chunk as the raw request body with the following query params:
 *   - uploadUri: The Google Drive resumable upload URI
 *   - start: Byte offset start
 *   - end: Byte offset end (exclusive)
 *   - total: Total file size
 *   - mimeType: File MIME type
 */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const { uploadUri, start, end, total, mimeType } = query as {
      uploadUri: string
      start: string
      end: string
      total: string
      mimeType: string
    }

    if (!uploadUri) {
      throw createError({ statusCode: 400, statusMessage: 'uploadUri is required' })
    }

    // Read the raw body (binary chunk)
    const chunkBuffer = await readRawBody(event, false)
    if (!chunkBuffer) {
      throw createError({ statusCode: 400, statusMessage: 'No chunk data provided' })
    }

    const startNum = parseInt(start)
    const endNum = parseInt(end)
    const totalNum = parseInt(total)

    const headers: Record<string, string> = {
      'Content-Range': `bytes ${startNum}-${endNum - 1}/${totalNum}`,
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Length': String(chunkBuffer.length),
    }

    const res = await fetch(uploadUri, {
      method: 'PUT',
      headers,
      body: chunkBuffer,
    })

    const isLast = endNum >= totalNum

    if (isLast) {
      if (!res.ok) {
        const errText = await res.text()
        throw createError({ statusCode: res.status, statusMessage: `Google Drive chunk error: ${errText}` })
      }
      const data = await res.json()
      return { success: true, done: true, file: data }
    } else {
      // Intermediate chunk — 308 Resume Incomplete is expected
      if (res.status !== 308 && !res.ok) {
        const errText = await res.text()
        throw createError({ statusCode: res.status, statusMessage: `Google Drive chunk error: ${errText}` })
      }
      return { success: true, done: false }
    }
  } catch (err: any) {
    console.error('Chunk proxy error:', err.message || err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.data?.statusMessage || err.message || 'Failed to proxy chunk',
    })
  }
})
