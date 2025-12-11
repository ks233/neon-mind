import { copyFile, writeFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { join, extname } from '@tauri-apps/api/path';
import type { CanvasModel, LogicNode, ImagePayload } from '@/types/model';
import { toRaw } from 'vue';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

export class ResourceManager {

    /**
     * [SAVE] 运行时 -> 硬盘
     * 处理未保存的图片，生成 localSrc，并剔除 displaySrc
     */
    static async localizeAssets(model: CanvasModel, targetDir: string): Promise<CanvasModel> {
        // 1. 深拷贝 (这是我们要修改并保存到硬盘的版本)
        const saveModel = structuredClone(toRaw(model));
        const assetsDir = await join(targetDir, 'assets');

        try {
            if (!(await exists(assetsDir))) {
                await mkdir(assetsDir, { recursive: true });
            }
        } catch (e) { /* ignore exist error */ }

        const nodes = Object.values(saveModel.nodes) as LogicNode[];

        console.trace()
        const canvasStore = useCanvasStore()
        const imageNodes = Object.values(nodes).filter(n => n.contentType === 'image');
        const pathsToCommit = imageNodes.filter(n => n.relativePath === undefined).map(n => n.runtimePath) as string[];
        const uniquePaths = [...new Set(pathsToCommit)];

        console.log(pathsToCommit)
        if (uniquePaths.length > 0) {
            try {
                // [核心] 告诉 Rust 把这些临时文件移动到项目 assets 目录下
                // 这一步是原子性的文件移动
                const newPaths = await invoke<string[]>('commit_assets', {
                    projectRoot: targetDir,
                    runtimePaths: pathsToCommit
                });
                console.log(newPaths)

                // 创建映射表
                const pathMap = new Map<string, string>();
                uniquePaths.forEach((oldPath, index) => {
                    pathMap.set(oldPath, newPaths[index]);
                });

                // [关键] 更新前端 Store 中的路径
                imageNodes.forEach(n => {
                    if (n.relativePath !== undefined) return;
                    const oldPath = n.runtimePath;
                    if (oldPath && pathMap.has(oldPath)) {
                        const newPath = pathMap.get(oldPath)
                        console.log("!!!", newPath)
                        n.relativePath = newPath
                        canvasStore.updateNode(n.id, node => {
                            (node as ImagePayload).relativePath = newPath;
                        }, false)
                    }
                    delete n.runtimePath
                });
            } catch (e) {
                console.error("Failed to commit assets", e);
            }
        }
        return saveModel;
    }
    /**
     * [LOAD] 硬盘 -> 运行时
     * 读取 localSrc，生成 displaySrc
     */
    static async restoreAssets(model: CanvasModel, projectRoot: string): Promise<CanvasModel> {
        const nodes = Object.values(model.nodes) as LogicNode[];

        for (const node of nodes) {
            if (node.contentType === 'image') {
                const imgNode = node as ImagePayload;

                if (imgNode.relativePath) {
                    // 拼接完整路径: D:/Project/assets/abc.png
                    const fullPath = await join(projectRoot, imgNode.relativePath);

                    // 转换为 runtimePath
                    imgNode.runtimePath = fullPath;
                }
            }
        }

        return model;
    }
}