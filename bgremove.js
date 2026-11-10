/* Background removal for player photos, all on the device (pictures are never uploaded anywhere).
   1. AI: Google's MediaPipe person segmentation (Apache-2.0). Loaded the first time it is used
      (about 10 MB, then cached by the browser) from jsDelivr and Google's model storage.
   2. Fallback, offline or if the AI can't load: removes a plain, even background (a wall, a sheet)
      by flooding in from the edges of the picture.
   BgRemove.remove(imageOrCanvas) → Promise<{ canvas, method: 'ai' | 'plain' }> */
window.BgRemove = (() => {
    const VERSION = '0.10.14';
    const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
    const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
    const MAX = 1024;
    let segmenterPromise = null;

    function toCanvas(src) {
        const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
        const sc = Math.min(1, MAX / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * sc); c.height = Math.round(h * sc);
        c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, c.width, c.height);
        return c;
    }

    function getSegmenter() {
        if (!segmenterPromise) {
            segmenterPromise = (async () => {
                const vision = await import(/* webpackIgnore: true */ `${CDN}/vision_bundle.mjs`);
                const files = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
                return vision.ImageSegmenter.createFromOptions(files, {
                    baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
                    runningMode: 'IMAGE',
                    outputCategoryMask: false,
                    outputConfidenceMasks: true
                });
            })();
            segmenterPromise.catch(() => { segmenterPromise = null; });
        }
        return segmenterPromise;
    }

    // Soft edge: confidence → alpha with a short ramp, so hair and shoulders don't look cut with scissors.
    const ramp = v => (v <= 0.35 ? 0 : v >= 0.65 ? 1 : (v - 0.35) / 0.3);

    async function removeAI(c) {
        const seg = await getSegmenter();
        const result = seg.segment(c);
        try {
            // The model's first mask is "background"; everything else (hair, skin, clothes) is the person.
            const bg = result.confidenceMasks[0];
            const data = bg.getAsFloat32Array(), mw = bg.width, mh = bg.height;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            const img = ctx.getImageData(0, 0, c.width, c.height), px = img.data;
            let kept = 0;
            for (let y = 0; y < c.height; y++) {
                const my = Math.min(mh - 1, Math.floor(y * mh / c.height));
                for (let x = 0; x < c.width; x++) {
                    const mx = Math.min(mw - 1, Math.floor(x * mw / c.width));
                    const a = ramp(1 - data[my * mw + mx]);
                    px[(y * c.width + x) * 4 + 3] = Math.round(px[(y * c.width + x) * 4 + 3] * a);
                    if (a > 0.5) kept++;
                }
            }
            const share = kept / (c.width * c.height);
            if (share < 0.02) throw new Error('No person found in the picture.');
            ctx.putImageData(img, 0, 0);
            return c;
        } finally {
            if (result && typeof result.close === 'function') result.close();
        }
    }

    // Plain background: colours along the picture's edge define the background; anything connected
    // to the edge and close to those colours is removed.
    function removePlain(c) {
        const w = c.width, h = c.height, ctx = c.getContext('2d', { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, w, h), px = img.data;
        // Scanned or printed photos often have a thin frame line, so look a little inside the edge
        // and treat everything outside that ring as background too.
        const ins = Math.round(Math.min(w, h) * 0.02) + 2;
        const L = ins, R = w - 1 - ins, T = ins, B = h - 1 - ins;
        // Background colour = the most common colour along the top and sides (the bottom edge is
        // usually the person's shoulders or shirt, so it isn't used).
        const edge = [];
        for (let x = L; x <= R; x += 2) edge.push((T * w + x) * 4);
        for (let y = T; y <= B; y += 2) edge.push((y * w + L) * 4, (y * w + R) * 4);
        const bins = new Map();
        edge.forEach(i => { const k = (px[i] >> 5) * 64 + (px[i + 1] >> 5) * 8 + (px[i + 2] >> 5); bins.set(k, (bins.get(k) || 0) + 1); });
        const top = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const members = edge.filter(i => (px[i] >> 5) * 64 + (px[i + 1] >> 5) * 8 + (px[i + 2] >> 5) === top);
        const mean = [0, 1, 2].map(k => members.reduce((s, i) => s + px[i + k], 0) / members.length);
        const near = edge.filter(i => Math.hypot(px[i] - mean[0], px[i + 1] - mean[1], px[i + 2] - mean[2]) < 45).length / edge.length;
        if (near < 0.55) throw new Error('The background is too busy to remove without the AI.');
        const spread = Math.sqrt(members.reduce((s, i) => s + [0, 1, 2].reduce((t, k) => t + (px[i + k] - mean[k]) ** 2, 0), 0) / members.length);
        const tol = Math.max(30, Math.min(60, spread * 3 + 26));
        const dist = i => Math.hypot(px[i] - mean[0], px[i + 1] - mean[1], px[i + 2] - mean[2]);
        const step = (i, j) => Math.hypot(px[i] - px[j], px[i + 1] - px[j + 1], px[i + 2] - px[j + 2]);
        // A pixel is background if it is close to the background colour, or if it is only a small step
        // from a background neighbour and not too far off (follows soft shadows and vignettes).
        const accept = (p, from) => { const d = dist(p * 4); return d < tol || (from >= 0 && d < tol * 1.7 && step(p * 4, from * 4) < 4); };
        const bg = new Uint8Array(w * h), stack = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < L || x > R || y < T || y > B) bg[y * w + x] = 1;
        for (let x = L; x <= R; x++) stack.push(T * w + x, -1);
        for (let y = T; y <= B; y++) stack.push(y * w + L, -1, y * w + R, -1);
        while (stack.length) {
            const from = stack.pop(), p = stack.pop();
            const x = p % w, y = (p / w) | 0;
            if (x < L || x > R || y < T || y > B) continue;
            if (bg[p] || !accept(p, from)) continue;
            bg[p] = 1;
            if (x > 0) stack.push(p - 1, p); if (x < w - 1) stack.push(p + 1, p);
            if (y > 0) stack.push(p - w, p); if (y < h - 1) stack.push(p + w, p);
        }
        let removed = 0;
        for (let p = 0; p < w * h; p++) {
            if (bg[p]) { removed++; px[p * 4 + 3] = 0; continue; }
            // feather one pixel next to the background
            const x = p % w, y = (p / w) | 0;
            const n = (x > 0 && bg[p - 1]) + (x < w - 1 && bg[p + 1]) + (y > 0 && bg[p - w]) + (y < h - 1 && bg[p + w]);
            if (n) px[p * 4 + 3] = Math.round(px[p * 4 + 3] * (1 - n * 0.2));
        }
        const share = removed / (w * h);
        if (share < 0.05 || share > 0.95) throw new Error('No plain background found.');
        ctx.putImageData(img, 0, 0);
        return c;
    }

    async function remove(src) {
        if (navigator.onLine !== false) {
            try { return { canvas: await removeAI(toCanvas(src)), method: 'ai' }; }
            catch (e) { console.warn('AI background removal unavailable:', e && e.message); }
        }
        return { canvas: removePlain(toCanvas(src)), method: 'plain' };
    }

    // Start downloading the AI early (e.g. when the photo editor opens) so the button is quicker.
    function warmUp() { if (navigator.onLine !== false) getSegmenter().catch(() => {}); }

    return { remove, warmUp };
})();
