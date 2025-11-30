import { onMounted, onUnmounted } from 'vue';
import { useVueFlow } from '@vue-flow/core';
import { useCanvasStore } from '@/stores/canvasStore';
import { snapToGrid } from '@/utils/grid';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useGlobalInteractions() {
    const store = useCanvasStore();
    const { screenToFlowCoordinate, getSelectedNodes } = useVueFlow();
    // 1. 处理全局粘贴
    async function handlePaste(e: ClipboardEvent) {
        // 如果当前焦点在输入框内，不拦截，让浏览器处理文字粘贴
        const activeEl = document.activeElement;
        if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable) {
            return;
        }

        const items = e.clipboardData?.items;
        if (!items) return;

        // 获取鼠标位置 (如果没有鼠标位置，默认放在屏幕中心或随机位置)
        // 这里简化处理：如果没有鼠标事件，我们假设在视口中心
        // 但 paste 事件不包含鼠标坐标，我们通常需要记录最后的鼠标位置，或者放在选中的节点旁边
        // 策略：如果有选中节点，作为子节点；否则放在 Viewport 中心。
        const selected = getSelectedNodes.value;
        const parentId = selected.length === 1 ? selected[0].id : undefined;

        // 计算生成位置 (如果是游离节点) -> 这里简化为固定位置或随机偏移
        // 实际项目中可以监听 mousemove 记录 lastMousePosition
        const dropPos = { x: 100 + Math.random() * 50, y: 100 + Math.random() * 50 };

        for (const item of items) {
            // A. 粘贴图片
            if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                if (file) {
                    store.addContentNode('image', file, dropPos, parentId);
                    e.preventDefault();
                }
            }
            // B. 粘贴文本 (检查是否为 URL)
            else if (item.type.indexOf('text/plain') !== -1) {
                item.getAsString((text) => {
                    if (isValidUrl(text)) {
                        store.addContentNode('link', text, dropPos, parentId);
                    } else {
                        // 如果不是 URL 且不是图片，也许可以创建一个 Markdown 节点？
                        // store.addFreeNode(...)
                    }
                });
            }
        }
    }
    // 辅助：URL 检测
    function isValidUrl(string: string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }
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

            paths.forEach((path) => {
                // 调用 Store 添加路径类型的图片节点
                // 注意：你需要确保 addContentNode 支持处理绝对路径字符串
                store.addContentNode('image', path, centerPos);
            });
        });
    });

    onUnmounted(() => {
        if (unlistenFileDrop) {
            unlistenFileDrop();
        }
    });


    // 挂载监听
    onMounted(() => {
        window.addEventListener('paste', handlePaste);
        // Drop 最好绑定在画布容器上，这里简化绑定到 window，或者在 App.vue 绑定到 div
    });

    onUnmounted(() => {
        window.removeEventListener('paste', handlePaste);
    });
    // 不再需要返回 handleDrop 给 template 用了
    return {};
}