/**
 * Media preparation — mirrors the proven approach used in IEC_APP_New.
 *
 * Images : resized to 800x800 (contain) and stepped down through JPEG
 *          qualities until the file is <= 50 KB.
 * Videos : compressed to <= 15 MB (auto mode first, then manual fallback
 *          steps); anything over 100 MB is rejected outright.
 */
import RNFS from 'react-native-fs';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import { Video as VideoCompressor, createVideoThumbnail } from 'react-native-compressor';

// ---- Limits (kept identical to IEC_APP_New) ----
export const MAX_IMAGE_BYTES = 50 * 1024; // 50 KB
const IMAGE_DIMENSION = 800;
const IMAGE_QUALITY_STEPS = [80, 70, 60, 50, 40, 30];

export const TARGET_VIDEO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_UPLOADABLE_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
const VIDEO_COMPRESSION_STEPS = [540, 360, 240];

// ---- helpers ----
const stripScheme = (uri) => String(uri || '').replace(/^file:\/\//, '');
const withScheme = (path) => {
  const p = String(path || '');
  return p.startsWith('file://') || p.startsWith('content://') ? p : `file://${p}`;
};

export const getFileSizeBytes = async (uri) => {
  try {
    const stats = await RNFS.stat(stripScheme(uri));
    return Number(stats?.size ?? 0);
  } catch {
    return 0;
  }
};

export const formatBytes = (bytes) => {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);

/**
 * Compress an image down to <= 50 KB.
 * Returns { uri, size }. If the target can't be reached, returns the smallest
 * result produced rather than failing.
 */
export const prepareImage = async (sourceUri) => {
  const sourcePath = stripScheme(sourceUri);
  if (!sourcePath) throw new Error('Missing image path');

  let bestPath = sourcePath;
  let bestSize = await getFileSizeBytes(sourcePath);

  // Already small enough — nothing to do.
  if (bestSize > 0 && bestSize <= MAX_IMAGE_BYTES) {
    return { uri: withScheme(sourcePath), size: bestSize };
  }

  for (const quality of IMAGE_QUALITY_STEPS) {
    try {
      const resized = await ImageResizer.createResizedImage(
        sourcePath,
        IMAGE_DIMENSION,
        IMAGE_DIMENSION,
        'JPEG',
        quality,
        0,
        undefined,
        false,
        { mode: 'contain', onlyScaleDown: true },
      );

      const path = stripScheme(resized?.path || resized?.uri || '');
      if (!path) continue;

      const size = await getFileSizeBytes(path);
      if (size > 0 && size < bestSize) {
        bestPath = path;
        bestSize = size;
      }
      if (size > 0 && size <= MAX_IMAGE_BYTES) {
        return { uri: withScheme(path), size };
      }
    } catch {
      // try the next, more aggressive quality step
    }
  }

  return { uri: withScheme(bestPath), size: bestSize };
};

/**
 * Compress a video to <= 15 MB.
 * Throws with a friendly message if the source is above the hard 100 MB cap.
 * Returns { uri, size }.
 */
export const prepareVideo = async (sourceUri) => {
  const safeUri = withScheme(sourceUri);
  const originalSize = await getFileSizeBytes(safeUri);

  if (originalSize > MAX_UPLOADABLE_VIDEO_BYTES) {
    throw new Error(
      `Video is ${formatBytes(originalSize)}. Please choose one under ${formatBytes(
        MAX_UPLOADABLE_VIDEO_BYTES,
      )}.`,
    );
  }

  // Already within target — skip the (slow) compression entirely.
  if (originalSize > 0 && originalSize <= TARGET_VIDEO_MAX_BYTES) {
    return { uri: safeUri, size: originalSize };
  }

  // 1) Auto mode — fastest, library picks settings.
  try {
    const autoUri = await withTimeout(
      VideoCompressor.compress(safeUri, {
        compressionMethod: 'auto',
        minimumFileSizeForCompress: 0,
      }),
      30000,
      'Auto compression',
    );
    if (autoUri) {
      const autoSize = await getFileSizeBytes(autoUri);
      if (autoSize > 0 && autoSize <= TARGET_VIDEO_MAX_BYTES) {
        return { uri: withScheme(autoUri), size: autoSize };
      }
    }
  } catch {
    // fall through to manual steps
  }

  // 2) Manual fallback — progressively smaller / lower bitrate.
  const isVeryLarge = originalSize > MAX_UPLOADABLE_VIDEO_BYTES;
  let best = { uri: safeUri, size: originalSize };

  for (let i = 0; i < VIDEO_COMPRESSION_STEPS.length; i++) {
    const maxSize = VIDEO_COMPRESSION_STEPS[i];
    const bitrate = isVeryLarge
      ? Math.max(100000, 350000 - i * 80000)
      : Math.max(150000, 450000 - i * 100000);

    try {
      const uri = await withTimeout(
        VideoCompressor.compress(safeUri, {
          compressionMethod: 'manual',
          maxSize,
          bitrate,
          minimumFileSizeForCompress: 0,
        }),
        60000,
        `Manual compression ${maxSize}p`,
      );
      if (!uri) continue;

      const size = await getFileSizeBytes(uri);
      if (size > 0 && (best.size === 0 || size < best.size)) {
        best = { uri: withScheme(uri), size };
      }
      if (size > 0 && size <= TARGET_VIDEO_MAX_BYTES) {
        return { uri: withScheme(uri), size };
      }
    } catch {
      // try the next, more aggressive step
    }
  }

  return best;
};

/**
 * Generate a thumbnail image for a video. Returns a uri, or null on failure
 * (callers should fall back to a placeholder tile).
 */
export const getVideoThumbnail = async (videoUri) => {
  try {
    const thumb = await withTimeout(
      createVideoThumbnail(withScheme(videoUri)),
      15000,
      'Thumbnail',
    );
    return thumb?.path ? withScheme(thumb.path) : null;
  } catch {
    return null;
  }
};
