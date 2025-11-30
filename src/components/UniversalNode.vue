<script setup lang="ts">
import { ref, nextTick, toRef, computed } from 'vue'
import { Handle, Position, useNode, type NodeProps } from '@vue-flow/core'
import { useResizeObserver } from '@vueuse/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import { useCanvasStore } from '@/stores/canvasStore'
import { useMindMapKeyboard } from '@/composables/useMindMapShortcuts'
import '@vue-flow/node-resizer/dist/style.css'

// 定义 Props
interface NodeData {
    logicNode: LogicNode
    isRoot?: boolean
    fixedSize?: boolean // 标记是否已被手动调整过大小
}
const props = defineProps<NodeProps<NodeData>>()

const showDebug = ref(false)

const { id } = useNode()
const store = useCanvasStore()
import { LogicNode } from '@/types/model'
import { resolveContentComponent } from '@/utils/contentResolver'

// === 状态管理 ===
const isEditing = ref(false)
const containerRef = ref<HTMLElement | null>(null) // 用于测量尺寸

// 计算当前是否被高亮 (拖拽反馈)
const isTarget = computed(() => store.dragTargetId === id)
const intent = computed(() => isTarget.value ? store.dragIntent : null)

// 计算是否固定尺寸
const isFixedSize = computed(() => props.data.fixedSize)

// 注入快捷键
const selectedRef = toRef(props, 'selected')
useMindMapKeyboard(id, selectedRef, isEditing)

const ContentComponent = computed(() =>
    resolveContentComponent(props.data.logicNode.contentType)
)

// === 自动尺寸上报 ===
useResizeObserver(containerRef, (entries) => {
    const entry = entries[0]
    const { width, height } = entry.contentRect

    // 只有在"自动模式"下，才把 DOM 的尺寸反向同步给 Store (用于 ELK 排版)
    // 加上简单的防抖判断避免微小抖动
    if (!isFixedSize.value && width > 0 && height > 0) {
        store.reportAutoContentSize(id, { width, height })
    }
})

// === 交互逻辑 ===

// 1. 双击进入编辑
function onDblClick(evt: MouseEvent) {
    evt.stopPropagation()
    isEditing.value = true
}

// 3. 手动调整大小结束
function onResizeEnd(evt: any) {
    const { width, height } = evt.params
    // 这会将 fixedSize 置为 true，切换到固定模式
    store.updateNodeSize(id, { width, height })
}

function handleUpdate(type: 'content' | 'url' | 'ratio', val: any) {
    switch (type) {
        case 'content':
            store.updateNodeContent(id, val);
            break;
        case 'url':
            // 这里可以触发一个异步 Action 去爬取 og:image
            store.updateNodeLink(id, val);
            break;
        case 'ratio':
            // 图片加载完成后更新比例，用于排版
            store.updateNodeData(id, { ratio: val });
            break;
    }
}

</script>

<template>
    <div
        ref="containerRef"
        class="universal-node"
        :class="{
            'is-root': data.isRoot,
            'selected': selectedRef,
            'auto-size': !isFixedSize,
            'fixed-size': isFixedSize,
            'drag-over-child': isTarget && intent === 'child',
            'drag-over-above': isTarget && intent === 'above',
            'drag-over-below': isTarget && intent === 'below',
            'dragging': dragging
        }"
        :style="isFixedSize ? { width: `${props.dimensions.width}px`, height: `${props.dimensions.height}px` } : {}"
        @dblclick="onDblClick"

        @mouseenter="showDebug = true"
        @mouseleave="showDebug = false">

        <NodeResizer
            :is-visible="true"
            :min-width="100"
            :min-height="40"
            :snap-grid="[20, 20]"
            line-class-name="invisible-resizer-line"
            handle-class-name="invisible-resizer-handle"
            @resize-end="onResizeEnd" />

        <Handle id="left" type="target" :position="Position.Left" class="io-handle" />
        <Handle id="top" type="target" :position="Position.Top" class="io-handle" />
        <Handle id="right" type="source" :position="Position.Right" class="io-handle" />
        <Handle id="bottom" type="source" :position="Position.Bottom" class="io-handle" />

        <div class="content-wrapper">
            <component
                :is="ContentComponent"
                :data="(data.logicNode as any)"
                :fixed-size="isFixedSize"
                :is-editing="isEditing"
                @blur="isEditing = false"
                @update:content="(v) => handleUpdate('content', v)"
                @update:url="(v) => handleUpdate('url', v)"
                @update:ratio="(v) => handleUpdate('ratio', v)" />
        </div>

        <div v-show="showDebug" class="debug-info">
            <span>({{ Math.round(position.x) }}, {{ Math.round(position.y || 0) }}) </span>
            <span>({{ Math.round(dimensions.width) }}, {{ Math.round(dimensions.height || 0) }}) </span>
            <span style="color: #ff4d4f">{{ id.substring(0, 8) }}</span><br>
            {{ data }}
        </div>
    </div>
</template>

<style scoped>
.universal-node {
    background: var(--node-bg);
    border: 2px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-color);
    padding: 0;

    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    transition: box-shadow 0.2s, border-color 0.2s;
}

/* === 模式 A: 自动大小 === */
.universal-node.auto-size {
    width: fit-content;
    height: fit-content;
    min-width: 80px;
    max-width: 400px;
    /* 限制最大宽度，超过自动换行 */
}

/* === 模式 B: 固定大小 === */
.universal-node.fixed-size {
    /* 宽高由 Vue Flow style 控制，这里强制填满 */
    width: 100%;
    height: 100%;
}

.content-wrapper {
    flex: 1;
    position: relative;
    display: grid;
    min-height: 24px;
    padding: 6px;
    overflow: hidden;
}

/* 选中状态 */
.universal-node.selected {
    border-color: #1890ff;
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
}

/* 根节点样式 */
.universal-node.is-root {
    background: #e6f7ff;
    border-color: #91d5ff;
}

.dark .universal-node.is-root {
    background: #111d2c;
    border-color: #177ddc;
}

/* Handle 样式 */
.io-handle {
    width: 4px;
    height: 4px;
    background: var(--handle-color);
    opacity: 0;
    transition: opacity 0.2s;
}

.universal-node:hover .io-handle,
.universal-node.selected .io-handle {
    opacity: 1;
}

/* 拖拽反馈样式 */
.drag-over-child {
    box-shadow: 0 0 0 3px #1890ff !important;
    background-color: rgba(24, 144, 255, 0.1);
}

.drag-over-above {
    border-top: 3px solid #ff4d4f !important;
}

.drag-over-below {
    border-bottom: 3px solid #ff4d4f !important;
}

.dragging {
    opacity: 0.5;
}

/* 强制隐藏线条 */
:deep(.invisible-resizer-line) {
    opacity: 0 !important;
}

/* 强制隐藏手柄，但保留鼠标交互 */
:deep(.invisible-resizer-handle) {
    background: transparent !important;
    border: none !important;
    /* 关键：虽然看不见，但鼠标放上去要变光标，且能点击 */
    /* VueFlow 默认样式已经处理了 cursor，这里只要确保它不透明度为0即可 */
}

/* 可选：当鼠标悬停在节点上时，微微显示一点手柄提示用户可以缩放？ */
/* 如果想要纯粹的 PureRef 风格（完全看不见），下面这段可以不加 */
.universal-node:hover :deep(.invisible-resizer-handle),
.universal-node:hover :deep(.invisible-resizer-line) {
    opacity: 0.1;
}

.debug-info {
    position: absolute;
    /* 向上偏移，数值等于标签高度 + 间距 */
    top: -26px;
    left: 0;

    /* 样式美化 */
    background: rgba(0, 0, 0, 0.85);
    color: #00ff9d;
    /* Matrix Green */
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-family: 'Consolas', monospace;
    line-height: 1;
    white-space: nowrap;
    /* 禁止换行 */
    pointer-events: none;
    /* 鼠标穿透，不挡操作 */
    z-index: 9999;
    /* 确保浮在所有东西上面 */

    /* 可选：加个小阴影 */
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
</style>