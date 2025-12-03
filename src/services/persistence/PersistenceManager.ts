import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { ResourceManager } from './ResourceManager';
import { JsonAdapter } from './adapters/JsonAdapter.ts';
import type { CanvasModel } from '@/types/model';

export class PersistenceManager {

    // 保存流程
    static async saveProjectAs(model: CanvasModel) {
        try {
            // 1. 让用户选择一个【文件夹】作为工程目录
            // 注意：Tauri dialog.open({ directory: true }) 让用户选目录
            const selectedDir = await open({
                directory: true,
                multiple: false,
                title: 'Select Project Folder'
            });

            if (!selectedDir) return;
            const projectRoot = selectedDir as string;

            // 2. 资源本地化 (复制图片 + 改路径)
            // 这会返回一个新的 Model，不影响当前正在编辑的 Model
            const portableModel = await ResourceManager.localizeAssets(model, projectRoot);

            // 3. 序列化
            const jsonString = JsonAdapter.stringify(portableModel);

            // 4. 写入主文件
            await writeTextFile(`${projectRoot}/data.json`, jsonString);

            console.log('Project saved to:', projectRoot);
            return projectRoot; // 返回路径用于更新 Store 里的 currentProjectPath
        } catch (e) {
            console.error('Save failed:', e);
        }
    }

    // 读取流程
    static async openProject(): Promise<{ model: CanvasModel, projectRoot: string } | null> {
        try {
            // 1. 让用户选择工程目录 (或者直接选 data.json 文件，看你交互设计)
            // 这里假设用户选择 data.json 文件
            const selectedFile = await open({
                filters: [{ name: 'Project Data', extensions: ['json'] }],
                title: 'Open Project Data'
            });

            if (!selectedFile) return null;
            const filePath = selectedFile as string; // "D:/Project/data.json"

            // 计算 Project Root ("D:/Project")
            // 简单的字符串处理，跨平台可能需要 path 库，但在浏览器环境简单 split 够用
            // 或者使用 tauri 的 path API
            const projectRoot = filePath.substring(0, filePath.lastIndexOf(navigator.userAgent.includes('Windows') ? '\\' : '/'));

            // 2. 读取文件
            const content = await readTextFile(filePath);

            // 3. 反序列化
            const rawModel = JsonAdapter.parse(content);

            // 4. 资源恢复 (把 ./assets/x.png 变成 asset://.../assets/x.png)
            const hydatedModel = await ResourceManager.restoreAssets(rawModel, projectRoot);

            return { model: hydatedModel, projectRoot: projectRoot };
        } catch (e) {
            console.error('Open failed:', e);
            return null;
        }
    }
}