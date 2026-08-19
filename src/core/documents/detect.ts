import {
  DocumentImportError,
  MAX_FILE_BYTES,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
  FAILURE_MESSAGES,
  type DocumentKind,
  type ImportCandidate
} from './types'

export function extensionOf(filename: string): string {
  const at = filename.lastIndexOf('.')
  return at === -1 ? '' : filename.slice(at).toLowerCase()
}

export function detectKind(candidate: ImportCandidate): DocumentKind | undefined {
  const byExtension = SUPPORTED_EXTENSIONS[extensionOf(candidate.filename)]
  if (byExtension) return byExtension

  const mime = candidate.mime?.split(';')[0]?.trim().toLowerCase()
  return mime ? SUPPORTED_MIME_TYPES[mime] : undefined
}

export function admit(candidate: ImportCandidate): DocumentKind {
  const kind = detectKind(candidate)
  if (!kind) {
    throw new DocumentImportError('unsupported_type', FAILURE_MESSAGES.unsupported_type, {
      filename: candidate.filename,
      extension: extensionOf(candidate.filename),
      mime: candidate.mime ?? null
    })
  }

  if (candidate.sizeBytes > MAX_FILE_BYTES) {
    throw new DocumentImportError('too_large', FAILURE_MESSAGES.too_large, {
      filename: candidate.filename,
      sizeBytes: candidate.sizeBytes,
      limitBytes: MAX_FILE_BYTES
    })
  }

  if (candidate.sizeBytes <= 0) {
    throw new DocumentImportError('empty_file', FAILURE_MESSAGES.empty_file, {
      filename: candidate.filename
    })
  }

  return kind
}

export function isSupported(candidate: ImportCandidate): boolean {
  try {
    admit(candidate)
    return true
  } catch {
    return false
  }
}
