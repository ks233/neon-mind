<script setup lang="ts">
import { NODE_CONSTANTS } from '@/config/layoutConfig'
import { useCanvasStore } from '@/stores/canvasStore'
import { useUiStore } from '@/stores/uiStore'
import { useVueFlow } from '@vue-flow/core'
import { computed } from 'vue'

const store = useCanvasStore()
// 预设颜色盘
const themeOptions = [
    { class: 'theme-default', name: 'Default' },
    { class: 'theme-red', name: 'Red' },
    { class: 'theme-yellow', name: 'Yellow' },
    { class: 'theme-green', name: 'Green' },
    { class: 'theme-blue', name: 'Blue' },
    { class: 'theme-purple', name: 'Purple' },
    { class: 'theme-pink', name: 'Pink' },
    { class: 'theme-grey', name: 'Grey' },
]

const scaleOptions = [
    { label: '1x', value: 1 },
    { label: '2x', value: 2 },
    { label: '3x', value: 3 },
    { label: '4x', value: 4 },
]

// 1. 获取选中的节点数组 (Reactive)

// === Actions (保持不变) ===
const uiStore = useUiStore()

function setAutoSize() {
    store.updateNodesBatch(uiStore.getSelectedNodeIds(), (node) => {
        node.fixedSize = false;
        node.width = 0;
        node.height = 0;
    });
}

function setFixedSize() {
    // 1. 建立一个"ID -> 真实尺寸"的查找表
    // 因为 store.updateNodesBatch 的回调里只能拿到 LogicNode (数据)，拿不到 VueFlow 的渲染尺寸
    const currentDimensions = new Map<string, { w: number, h: number }>()
    const selectedNodes = uiStore.getSelectedNodes()
    selectedNodes.forEach(n => {
        // n.dimensions 是 Vue Flow 实时测量出的 DOM 尺寸
        currentDimensions.set(n.id, {
            w: n.dimensions.width || 0,
            h: n.dimensions.height || 0
        })
    })

    const selectedIds = uiStore.getSelectedNodeIds()
    // 2. 批量更新
    store.updateNodesBatch(selectedIds, (node) => {
        node.fixedSize = true;

        // 获取该节点的视觉尺寸
        const visual = currentDimensions.get(node.id);

        if (visual) {
            // [核心逻辑] 使用视觉尺寸，但不得小于最小值
            node.width = Math.max(visual.w, NODE_CONSTANTS.MIN_WIDTH);
            node.height = Math.max(visual.h, NODE_CONSTANTS.MIN_HEIGHT);
        } else {
            // 兜底：如果没有视觉尺寸，使用默认最小值
            node.width = NODE_CONSTANTS.MIN_WIDTH;
            node.height = NODE_CONSTANTS.MIN_HEIGHT;
        }
    });
}

function setTheme(themeClass: string) {
    const selectedIds = uiStore.getSelectedNodeIds()
    store.updateNodesBatch(selectedIds, (node) => {
        // 1. 设置类名
        node.class = themeClass;
    });
}

function setScale(scale: number) {
    const selectedIds = uiStore.getSelectedNodeIds()
    store.updateNodesBatch(selectedIds, (node) => {
        node.contentScale = scale;
    });
}
</script>

<template>
    <Transition name="fade-scale">
        <div
            v-if="uiStore.selectionCount > 0"
            class="selection-toolbar">
            <div class="group">
                <button @click="setAutoSize" title="自动大小">AUTO</button>
                <button @click="setFixedSize" title="固定大小">FIXED</button>
            </div>

            <div class="divider"></div>

            <div class="group color-picker">
                <button
                    v-for="t in themeOptions"
                    :key="t.class"
                    class="color-btn"
                    :class="t.class"
                    @click="setTheme(t.class)"></button>
            </div>

            <div class="divider"></div>
            <div class="group">
                <button
                    v-for="opt in scaleOptions"
                    :key="opt.value"
                    @click="setScale(opt.value)"
                    :class="{ 'active': (uiStore.selectedNodes[0].data.logicNode.contentScale ?? 1) === opt.value }"
                    title="Zoom Content">
                    {{ opt.label }}
                </button>
            </div>
            <!-- <template v-if="uiStore.selectionCount > 1">
                <div class="divider"></div>
                <div class="info">{{ uiStore.selectionCount }} selected</div>
            </template> -->
        </div>
    </Transition>
</template>

<style scoped>
.selection-toolbar {
    position: absolute;
    bottom: 40px;
    /* 距离底部 */
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    /* 保证在节点之上 */

    display: flex;
    align-items: center;
    gap: 12px;

    background: var(--node-bg);
    border: 1px solid var(--border-color);
    padding: 8px 16px;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

    /* 毛玻璃效果 */
    backdrop-filter: blur(8px);
    background-color: rgba(0, 0, 0, 0.2);
}

:global(.dark) .selection-toolbar {
    background-color: rgba(30, 30, 30, 0.95);
}

.group {
    display: flex;
    gap: 4px;
    align-items: center;
}

.divider {
    width: 1px;
    height: 16px;
    background: var(--border-color);
    opacity: 0.5;
}

.info {
    font-size: 12px;
    color: #888;
    margin-left: 4px;
}

button {
    cursor: pointer;
    border: none;
    background: transparent;
    color: var(--text-color);
    padding: 4px 6px;
    border-radius: 4px;
    transition: all 0.2s;
}

button:hover {
    background: rgba(150, 150, 150, 0.1);
}

.color-btn {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    padding: 0;
    cursor: pointer;

    /* [!code focus:6] 核心修改：使用 CSS 变量 */
    /* 因为按钮上挂载了 t.class (如 .theme-red)，所以这里的变量会自动解析为红色 */
    background-color: var(--node-bg);
    border: 2px solid var(--border-color);
    /* 使用主题定义的边框色 */

    transition: transform 0.2s, border-color 0.2s;
}

.color-btn:hover {
    transform: scale(1.2);
}

/* 动画：简单的淡入 + 缩放 */
.fade-scale-enter-active,
.fade-scale-leave-active {
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
    opacity: 0;
    transform: translate(-50%, -100%) translateY(0px) scale(0.95);
    /* 修正 transform 覆盖问题 */
}

button.active {
    background-color: var(--text-color);
    color: var(--node-bg);
    /* 反色高亮 */
    font-weight: bold;
}
</style>