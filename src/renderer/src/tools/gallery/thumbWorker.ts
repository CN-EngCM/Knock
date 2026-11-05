// 缩略图 Worker：把解码和缩放挪出页面线程和主进程。
// 收 { id, format }，回 { id, bytes } 或 { id, error }；字节由 thumbQueue 经 gallerySaveThumb 落盘。
// 不加 lib="webworker"（会和 DOM 类型冲突），DOM 里已有 createImageBitmap / OffscreenCanvas，
// self 只需断言出用到的两个成员。

type Req = { id: number; format: string };
const ctx = self as unknown as {
    onmessage: ((e: MessageEvent<Req>) => void) | null;
    postMessage(msg: unknown, transfer?: Transferable[]): void;
};

const LONG_EDGE = 320;

ctx.onmessage = async (e) => {
    const { id, format } = e.data;
    try {
        const res = await fetch(`mpimg://orig/${id}`);
        if (!res.ok) throw new Error(`orig ${res.status}`);
        // 先全尺寸解码：解码时浏览器已按 EXIF 摆正，目标尺寸必须从解码结果算，不能用库里存的宽高
        const src = await createImageBitmap(await res.blob());
        const scale = Math.min(1, LONG_EDGE / Math.max(src.width, src.height)); // 不放大
        const w = Math.max(1, Math.round(src.width * scale));
        const h = Math.max(1, Math.round(src.height * scale));
        const small =
            scale < 1
                ? await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" })
                : src;
        if (small !== src) src.close();

        const canvas = new OffscreenCanvas(w, h);
        const g = canvas.getContext("2d");
        if (!g) throw new Error("no 2d context");
        g.drawImage(small, 0, 0);
        small.close();

        // 命名规则与主进程一致：jpg 存 jpg，其余存 png（保透明）
        const blob = await canvas.convertToBlob(
            format === "jpg" ? { type: "image/jpeg", quality: 0.85 } : { type: "image/png" },
        );
        const bytes = await blob.arrayBuffer();
        ctx.postMessage({ id, bytes }, [bytes]);
    } catch (err) {
        ctx.postMessage({ id, error: String(err) });
    }
};
