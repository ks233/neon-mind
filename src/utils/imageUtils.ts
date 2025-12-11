import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

/**
 * 统一资源定位符生成器
 * @param path 图片存储的路径 (可能是 "_temp/..." 或 "assets/..." 或 "C:/...")
 * @param width 请求的 LOD 宽度
 */
export function getResourceUrl(path: string, width: number): string {
    const projectStore = useProjectStore();
    const encodedPath = encodeURIComponent(path);
    let url = `http://thumb.localhost/${encodedPath}?w=${width}`;

    // 如果是相对路径 (assets/...)，必须带上项目根目录供后端解析
    if (!path.startsWith('_temp/') && !path.includes(':')) {
        if (projectStore.projectDir) {
            const encodedRoot = encodeURIComponent(projectStore.projectDir);
            url += `&root=${encodedRoot}`;
        }
    }

    return url;
}