// Framework-agnostic image crop math for FP3D_Mode picture inserts.
//
// NO Phaser and NO Three.js imports (Req 9.1). Computes a "cover" crop: the
// largest source rectangle with the target aspect ratio that fits inside the
// image, so a photo fills a frame opening without being stretched. The caller
// draws that rectangle onto a canvas of the target size.

/**
 * Largest crop rectangle of `targetAspect` (width / height) that fits inside a
 * `srcW` × `srcH` image. One side always spans the full image, so nothing is
 * stretched and no more is cut than needed. `focusX` / `focusY` in [0, 1] pick
 * which part is kept along the cropped axis (0 = left/top, 0.5 = centre,
 * 1 = right/bottom).
 * @param {number} srcW source width in pixels (> 0)
 * @param {number} srcH source height in pixels (> 0)
 * @param {number} targetAspect target width / height (> 0)
 * @param {number} [focusX=0.5] horizontal focus when cropping width
 * @param {number} [focusY=0.5] vertical focus when cropping height
 * @returns {{ sx: number, sy: number, sw: number, sh: number }} source rect
 */
export function coverCropRect(srcW, srcH, targetAspect, focusX = 0.5, focusY = 0.5) {
  const ok = (v) => Number.isFinite(v) && v > 0;
  if (!ok(srcW) || !ok(srcH) || !ok(targetAspect)) {
    return { sx: 0, sy: 0, sw: ok(srcW) ? srcW : 0, sh: ok(srcH) ? srcH : 0 };
  }
  const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
  const fx = clamp01(focusX);
  const fy = clamp01(focusY);

  if (srcW / srcH > targetAspect) {
    // Image is wider than the target: keep full height, trim the sides.
    const sw = srcH * targetAspect;
    return { sx: (srcW - sw) * fx, sy: 0, sw, sh: srcH };
  }
  // Image is taller (or equal): keep full width, trim top/bottom.
  const sh = srcW / targetAspect;
  return { sx: 0, sy: (srcH - sh) * fy, sw: srcW, sh };
}
