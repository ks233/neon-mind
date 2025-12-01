import { copyFile, writeFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { join, extname } from '@tauri-apps/api/path';
import type { CanvasModel, LogicNode, ImagePayload } from '@/types/model';
import { toRaw } from 'vue';

export class ResourceManager {

    /**
     * [SAVE] 运行时 -> 硬盘
     * 处理未保存的图片，生成 localSrc，并剔除 displaySrc
     */
    static async localizeAssets(model: CanvasModel, targetDir: string): Promise<CanvasModel> {
        // 1. 深拷贝 (这是我们要修改并保存到硬盘的版本)
        const saveModel = structuredClone(toRaw(model)); const assetsDir = await join(targetDir, 'assets');

        try {
            if (!(await exists(assetsDir))) {
                await mkdir(assetsDir, { recursive: true });
            }
        } catch (e) { /* ignore exist error */ }

        const nodes = Object.values(saveModel.nodes) as LogicNode[];

        for (const node of nodes) {
            if (node.contentType === 'image') {
                const imgNode = node as ImagePayload;

                // [核心逻辑]
                // 只要没有 localSrc，就说明需要保存 (不管它是 blob 还是 asset 还是 http)
                if (!imgNode.localSrc && imgNode.displaySrc) {
                    try {
                        // 1. 统一使用 fetch 获取数据流
                        // 无论是 blob:, asset://, 还是 https://，fetch 都能搞定
                        const response = await fetch(imgNode.displaySrc);

                        if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

                        const blob = await response.blob();
                        const arrayBuffer = await blob.arrayBuffer();
                        const fileData = new Uint8Array(arrayBuffer);

                        // 2. 智能推断扩展名
                        // 优先从 URL 拿，拿不到从 MIME type 拿
                        let ext = 'png'; // 兜底

                        // 尝试从 displaySrc 提取后缀 (例如 xxx.jpg)
                        // 简单的正则提取，处理 asset:// 路径
                        const urlMatch = imgNode.displaySrc.match(/\.([a-zA-Z0-9]+)($|\?)/);
                        if (urlMatch) {
                            ext = urlMatch[1];
                        } else {
                            // 从 Blob 的 type 推断 (例如 image/jpeg)
                            const mimeExt = blob.type.split('/')[1];
                            if (mimeExt) ext = mimeExt;
                        }

                        // 3. 计算内容哈希 (实现完美去重)
                        // 哪怕你拖进来两次同一个文件，或者复制粘贴了两次，
                        // 只要内容一样，它们就会指向同一个 assets 文件
                        const hash = crypto.randomUUID();
                        const filename = `${hash}.${ext}`;
                        const targetPath = await join(assetsDir, filename);

                        // 4. 写入硬盘
                        // 检查文件是否已存在 (哈希去重的好处：存在就不用写了)
                        if (!(await exists(targetPath))) {
                            await writeFile(targetPath, fileData);
                        }

                        // 5. 更新 Model
                        imgNode.localSrc = filename; // 记录相对路径

                    } catch (e) {
                        console.error(`Failed to save image: ${imgNode.displaySrc}`, e);
                        // 即使失败，也保留 displaySrc 以便下次尝试，或者让用户看到坏图
                    }
                }

                // 清理运行时字段
                delete imgNode.displaySrc;
            }
        }
        return saveModel;
    }
    /**
     * [LOAD] 硬盘 -> 运行时
     * 读取 localSrc，生成 displaySrc
     */
    static async restoreAssets(model: CanvasModel, projectRoot: string): Promise<CanvasModel> {
        const assetsDir = await join(projectRoot, 'assets');

        const nodes = Object.values(model.nodes) as LogicNode[];

        for (const node of nodes) {
            if (node.contentType === 'image') {
                const imgNode = node as ImagePayload;

                if (imgNode.localSrc) {
                    // 拼接完整路径: D:/Project/assets/abc.png
                    const fullPath = await join(assetsDir, imgNode.localSrc);

                    // 转换为 WebView 可读路径
                    imgNode.displaySrc = convertFileSrc(fullPath);
                }
            }
        }

        return model;
    }
}