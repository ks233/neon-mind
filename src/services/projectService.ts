// src/services/projectService.ts
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import type { CanvasModel } from '@/types/model';

// JSON 序列化处理 Set
function replacer(key: string, value: any) {
    if (key === 'rootNodes' && value instanceof Set) {
        return Array.from(value);
    }
    return value;
}

// JSON 反序列化处理 Set
function reviver(key: string, value: any) {
    if (key === 'rootNodes' && Array.isArray(value)) {
        return new Set(value);
    }
    return value;
}

export class ProjectService {
    // 保存文件
    static async saveProject(model: CanvasModel) {
        try {
            // 1. 弹出保存对话框
            const path = await save({
                filters: [{ name: 'Mind Canvas File', extensions: ['mc'] }]
            });

            if (!path) return;

            // 2. 构造文件内容
            const fileContent = {
                version: 1,
                updatedAt: Date.now(),
                model: model // 这里面包含了 nodes, edges, rootNodes
            };

            // 3. 写入硬盘
            await writeTextFile(path, JSON.stringify(fileContent, replacer, 2));

            console.log('Saved to:', path);
            return path; // 返回路径以便后续自动保存
        } catch (e) {
            console.error('Save failed:', e);
        }
    }

    // 打开文件
    static async openProject(): Promise<CanvasModel | null> {
        try {
            const path = await open({
                filters: [{ name: 'Mind Canvas File', extensions: ['mc'] }]
            });

            if (!path || typeof path !== 'string') return null;

            const content = await readTextFile(path);
            const rawData = JSON.parse(content, reviver);

            // 这里可以插入 migrateData(rawData) 逻辑

            return rawData.model;
        } catch (e) {
            console.error('Open failed:', e);
            return null;
        }
    }
}