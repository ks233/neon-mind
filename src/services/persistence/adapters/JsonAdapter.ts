import type { CanvasModel } from '@/types/model';

// 处理 Set 序列化
function replacer(key: string, value: any) {
    if (key === 'rootNodes' && value instanceof Set) {
        return Array.from(value);
    }
    return value;
}

// 处理 Set 反序列化
function reviver(key: string, value: any) {
    if (key === 'rootNodes' && Array.isArray(value)) {
        return new Set(value);
    }
    return value;
}

export class JsonAdapter {
    static stringify(model: CanvasModel): string {
        const fileContent = {
            version: 1,
            meta: { app: 'MindCanvas', updatedAt: Date.now() },
            model: model
        };
        return JSON.stringify(fileContent, replacer, 2);
    }

    static parse(content: string): CanvasModel {
        const json = JSON.parse(content, reviver);
        // 这里可以加 migrateData(json) 逻辑
        return json.model;
    }
}