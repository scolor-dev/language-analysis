(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.imageUtils = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function buildAdaptiveThresholdMask(grayscale, width, height, options = {}) {
    const windowSize = Math.max(9, options.windowSize ?? Math.max(15, Math.round(Math.min(width, height) / 18)));
    const radius = Math.floor(windowSize / 2);
    const stride = width + 1;
    const integral = new Float32Array((width + 1) * (height + 1));
    const integralSq = new Float32Array((width + 1) * (height + 1));

    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      let rowSqSum = 0;
      for (let x = 0; x < width; x++) {
        const value = grayscale[y * width + x];
        rowSum += value;
        rowSqSum += value * value;
        const index = (y + 1) * stride + (x + 1);
        integral[index] = integral[y * stride + (x + 1)] + rowSum;
        integralSq[index] = integralSq[y * stride + (x + 1)] + rowSqSum;
      }
    }

    const mask = new Uint8Array(grayscale.length);
    const k = options.k ?? 0.18;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - radius);
        const y0 = Math.max(0, y - radius);
        const x1 = Math.min(width - 1, x + radius);
        const y1 = Math.min(height - 1, y + radius);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = rectSum(integral, x0, y0, x1, y1, stride);
        const sqSum = rectSum(integralSq, x0, y0, x1, y1, stride);
        const mean = sum / area;
        const variance = sqSum / area - mean * mean;
        const std = Math.sqrt(Math.max(0, variance));
        const threshold = mean - k * std;
        const value = grayscale[y * width + x];
        mask[y * width + x] = value < threshold ? 1 : 0;
      }
    }
    return mask;
  }

  function mergeDetectionMasks(grayscale, width, height, adaptiveMask, globalThreshold, bias = 10) {
    const merged = new Uint8Array(grayscale.length);
    const lowThreshold = Math.max(10, globalThreshold - bias);
    for (let i = 0; i < grayscale.length; i++) {
      const adaptive = adaptiveMask[i];
      const global = grayscale[i] < lowThreshold;
      merged[i] = adaptive || global ? 1 : 0;
    }
    return merged;
  }

  function rectSum(integral, x0, y0, x1, y1, stride) {
    const bottomRight = (y1 + 1) * stride + (x1 + 1);
    const topRight = y0 * stride + (x1 + 1);
    const bottomLeft = (y1 + 1) * stride + x0;
    const topLeft = y0 * stride + x0;
    return integral[bottomRight] - integral[topRight] - integral[bottomLeft] + integral[topLeft];
  }

  return { buildAdaptiveThresholdMask, mergeDetectionMasks };
});
