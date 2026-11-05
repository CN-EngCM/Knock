// 便签的上限与可加的图片格式。主进程在 server/schemas.ts 里有同一份（NOTE_*）做硬兜底；
// 渲染进程禁止运行时 import 主进程的值，所以这里手工复制，改一边要改另一边。
export const NOTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const NOTE_MAX_IMAGES = 20;
export const NOTE_TEXT_MAX_CHARS = 100_000;

const MIME_OK = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"];
const EXT_OK = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];

/** 文件选择框的 accept 串 */
export const NOTE_IMAGE_ACCEPT = MIME_OK.join(",");

/** 先看 MIME，MIME 为空时（部分来源不带）退回看扩展名；真正的格式以主进程按文件头判定为准 */
export function isSupportedImage(file: File): boolean {
    if (file.size === 0) return false;
    if (file.type) return MIME_OK.includes(file.type);
    return EXT_OK.includes(file.name.split(".").pop()?.toLowerCase() ?? "");
}
