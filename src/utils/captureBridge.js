/**
 * Tiny bridge to hand captured media from CameraScreen back to the Task form.
 *
 * Why not route params? Navigating back with params can re-create the target
 * screen (losing its media state, so each capture appeared to replace the
 * previous one). The camera now just emits here and calls goBack(), which
 * leaves the Task form mounted with its state intact.
 */
let handler = null;

export const setCaptureHandler = (fn) => {
  handler = fn;
};

export const clearCaptureHandler = () => {
  handler = null;
};

export const emitCapture = (media) => {
  handler?.(media);
};
