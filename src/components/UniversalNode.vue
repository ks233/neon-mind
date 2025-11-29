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
    content: string
    isRoot?: boolean
    fixedSize?: boolean // 标记是否已被手动调整过大小
}
const props = defineProps<NodeProps<NodeData>>()

const showDebug = ref(false)

const { id } = useNode()
const store = useCanvasStore()

import ContentMarkdown from './contents/ContentMarkdown.vue'

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


// === 核心逻辑：组件分发 ===
const ResolvedContent = computed(() => {
    // 未来在这里写 switch/case 逻辑
    // if (props.data.imageUrl) return ContentImage
    return ContentMarkdown
})

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

// 2. 失焦保存
function onBlur() {
    isEditing.value = false
}

function onContentUpdate(val: string) {
    store.updateNodeContent(id, val)
}

// 3. 手动调整大小结束
function onResizeEnd(evt: any) {
    const { width, height } = evt.params
    // 这会将 fixedSize 置为 true，切换到固定模式
    store.updateNodeSize(id, { width, height })
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
            'dragging' : dragging
        }"
        :style="isFixedSize ? { width: `${props.dimensions.width}px`, height: `${props.dimensions.height}px` } : {}"
        @dblclick="onDblClick"

        @mouseenter="showDebug = true"
        @mouseleave="showDebug = false"
        tabindex="0">

        <NodeResizer
            :is-visible="selectedRef"
            :min-width="100"
            :min-height="40"
            :snap-grid="[20, 20]"
            @resize-end="onResizeEnd" />

        <Handle id="left" type="target" :position="Position.Left" class="io-handle" />
        <Handle id="top" type="target" :position="Position.Top" class="io-handle" />
        <Handle id="right" type="source" :position="Position.Right" class="io-handle" />
        <Handle id="bottom" type="source" :position="Position.Bottom" class="io-handle" />

        <component
            :is="ContentMarkdown"
            :content="data.content"
            :fixed-size="isFixedSize"
            :is-editing="isEditing"
            @update:content="onContentUpdate"
            @blur="isEditing = false" />
    </div>
            <div v-show="showDebug" class="debug-info">
            <span>({{ Math.round(position.x) }}, {{ Math.round(position.y || 0) }}) </span>
            <span>({{ Math.round(dimensions.width) }}, {{ Math.round(dimensions.height || 0) }}) </span>
            <span style="color: #ff4d4f">{{ id.substring(0, 8) }}</span><br>
            <div>{{ JSON.stringify(props, null, 4) }}</div>
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
    /* transition: box-shadow 0.2s, border-color 0.2s; */
    transition: all 0.2s;
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
    /* 关键：让 Ghost 和 Textarea 重叠 */
    min-height: 24px;
    padding: 8px 12px;
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
    font-weight: bold;
    font-size: 16px;
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