import { onKeyStroke, useMouse } from '@vueuse/core';
import { useVueFlow } from '@vue-flow/core';
import { useUiStore } from '@/stores/uiStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { isInputActive } from '@/utils/keyboard'; // 假设你有这个工具函数
import { VisualSnapshot } from '@/types/model';
import { snapToGridXY } from '@/utils/grid';

export function useClipboard() {
    const canvasStore = useCanvasStore();
    const { screenToFlowCoordinate } = useVueFlow();
    const { x, y } = useMouse();

    const uiStore = useUiStore();
    const { getNodes } = useVueFlow(); // [!code focus]
    // ...

    // 辅助：生成视觉快照 Map
    function getVisualMap(): Map<string, VisualSnapshot> {
        const map = new Map<string, VisualSnapshot>();
        // 获取 Vue Flow 内部所有节点 (包含真实坐标和尺寸)
        const graphNodes = getNodes.value;

        graphNodes.forEach(gn => {
            map.set(gn.id, {
                x: gn.computedPosition.x, // 绝对坐标
                y: gn.computedPosition.y,
                width: gn.dimensions.width,
                height: gn.dimensions.height
            });
        });
        return map;
    }

    // 复制 (Ctrl + C)
    onKeyStroke('c', async (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (isInputActive()) return;
        e.preventDefault();

        // 1. 获取选中 ID
        const selectedIds = uiStore.getSelectedNodeIds();
        if (selectedIds.length === 0) return;

        // 2. [核心] 获取视觉快照
        const visualMap = getVisualMap();

        // 3. 调用 Store，传入数据
        await canvasStore.copySelection(selectedIds, visualMap);
    });

    // 粘贴 (Ctrl + V)
    onKeyStroke('v', async (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (isInputActive()) return;
        e.preventDefault();

        const mousePos = screenToFlowCoordinate({
            x: x.value,
            y: y.value
        });
        // 调用 Store 的智能粘贴
        await canvasStore.pasteFromClipboard(snapToGridXY(mousePos));
    });
}