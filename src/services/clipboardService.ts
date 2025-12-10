// src/services/clipboardService.ts
import { writeText, readText, readImage } from '@tauri-apps/plugin-clipboard-manager';
import { writeFile, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { Image } from '@tauri-apps/api/image';

const CLIPBOARD_FILE = 'clipboard_nodes.json';
const REF_PREFIX = 'MINDMAP_CLIP_REF::';

export interface ClipboardResult {
    type: 'nodes' | 'image' | 'text' | 'link' | 'empty';
    data: any;
}

export const ClipboardService = {
    async copyNodes(nodes: any[]) {
        try {
            const timestamp = Date.now();
            // 1. 写入本地文件 (持久化，跨进程)
            const data = JSON.stringify({ timestamp, nodes });
            await writeFile(CLIPBOARD_FILE, new TextEncoder().encode(data), {
                baseDir: BaseDirectory.AppCache,
            });

            // 2. 写入系统剪贴板 (作为占位符和标记)
            // 这样如果用户在别的软件复制了东西，这个标记就会被覆盖
            await writeText(`${REF_PREFIX}${timestamp}`);

        } catch (e) {
            console.error('Copy failed:', e);
        }
    },

    async tauriImageToDataUrl(tauriImage: Image): Promise<string> {
        const rgba = await tauriImage.rgba();
        const size = await tauriImage.size();

        // 1. 创建离屏 Canvas
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to create canvas context');

        // 2. 将 RGBA 数据填充到 ImageData
        // Tauri 返回的是 Uint8Array，需要转为 Uint8ClampedArray 供 Canvas 使用
        const imageData = new ImageData(
            new Uint8ClampedArray(rgba),
            size.width,
            size.height
        );

        // 3. 绘制并转换
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    },

    async readClipboard(): Promise<ClipboardResult> {
        try {
            // 1. 先读文本，检查引用标记
            // 为什么先读文本？因为如果是我们复制的节点，文本里会有 REF 标记
            const text = await readText().catch(() => ''); // catch 这里的错误，因为剪贴板可能是纯图片

            // A. 如果是我们的节点引用 (说明最后一次复制操作是在本软件内进行的)
            if (text && text.startsWith(REF_PREFIX)) {
                try {
                    const fileContent = await readTextFile(CLIPBOARD_FILE, {
                        baseDir: BaseDirectory.AppCache,
                    });
                    const json = JSON.parse(fileContent);
                    return { type: 'nodes', data: json.nodes };
                } catch (e) {
                    // 文件可能丢了，降级处理
                }
            }

            // B. 检查系统剪贴板是否有图片 (说明用户在外部复制了图片)
            // 只有当 text 不是 REF 时才走到这里，或者 REF 被覆盖了
            try {
                const image = await readImage();
                if (image) {
                    const base64Url = await this.tauriImageToDataUrl(image);
                    return { type: 'image', data: base64Url };
                }
            } catch (e) { }

            // C. 检查是否是普通链接
            if (text && /^https?:\/\//.test(text.trim())) {
                return { type: 'link', data: text.trim() };
            }

            // D. 普通文本
            if (text) {
                // 如果不替换 CRLF，CodeMirror 会初始化失败
                const cleanText = text.replace(/\r\n/g, '\n')
                console.log(JSON.stringify(text), text.length)
                console.log(JSON.stringify(cleanText), cleanText.length)
                return { type: 'text', data: cleanText };
            }

            return { type: 'empty', data: null };

        } catch (e) {
            return { type: 'empty', data: null };
        }
    }
};