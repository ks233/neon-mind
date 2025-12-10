import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { onMounted, onUnmounted } from 'vue';

export function useGlobalInteractions() {
    const canvasStore = useCanvasStore();
    const projectStore = useProjectStore();

    let unlistenFileDrop: (() => void) | null = null;
    onMounted(async () => {
        // 监听 Tauri 系统级的文件拖放事件
        // payload 是一个文件路径数组: string[]
        unlistenFileDrop = await getCurrentWebview().onDragDropEvent((event) => {
            if (event.payload.type !== 'drop') return;
            const paths = event.payload.paths as string[];

            console.log('Tauri File Drop Detected:', paths);
            // 计算中心点 (因为系统拖放事件不包含鼠标坐标)
            // 如果你想获取鼠标位置，需要配合 js 的 dragover 记录位置
            const centerPos = { x: 0, y: 0 };

            paths.forEach(async (path) => {
                // 调用 Store 添加路径类型的图片节点
                // 注意：你需要确保 addContentNode 支持处理绝对路径字符串
                canvasStore.addImage(centerPos, convertFileSrc(path), await projectStore.tryGetRelativePath(path));
            });
        });
    });

    onUnmounted(() => {
        if (unlistenFileDrop) {
            unlistenFileDrop();
        }
    });

    return {};
}