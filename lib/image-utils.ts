
/**
 * Checks if a string is a valid image URL for display.
 * Filters out revoked blob URLs or invalid formats.
 */
export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('blob:')) return false; // Blobs are temporary and prone to ERR_FILE_NOT_FOUND
  if (url.startsWith('data:image/')) return true; // Base64 is okay for small previews/mock persistence
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  return false;
}

/**
 * Converts a File object to a Base64 encoded string.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}
