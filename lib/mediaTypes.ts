// Single source of truth for which media MIME types this app accepts and how
// they map to storage file extensions — used by every upload/serve route.
// Previously duplicated across five files with the same narrow list
// (video/webm, video/mp4, image/jpeg, image/png, image/webp only), which
// silently rejected real-world files the browser's own file picker
// (accept="video/*,image/*") had no problem selecting — most commonly an
// iPhone's default .mov export (video/quicktime).

export const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov", // iPhone's default video export format
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp", // older/feature-phone camcorder output
};

export const ALLOWED_MEDIA_TYPES = Object.keys(EXT_BY_MIME) as [string, ...string[]];

/** Inverse of EXT_BY_MIME — the extension a stored file was saved under is the source of truth for what Content-Type to serve it back as. */
export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]));

/**
 * Browsers sometimes report a MIME type with codec parameters attached (e.g.
 * `video/webm;codecs=vp9,opus`) — strip that suffix before comparing against
 * the allowlist above, which only ever lists bare container types.
 */
export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}
