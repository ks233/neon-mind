<script setup lang="ts">
import { ref, nextTick, toRef, computed } from 'vue'
import { Handle, Position, useNode, type NodeProps } from '@vue-flow/core'
import { useResizeObserver } from '@vueuse/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import MarkdownIt from 'markdown-it'
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
const md = new MarkdownIt({ html: true, linkify: true, breaks: true })

// === 状态管理 ===
const isEditing = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const containerRef = ref<HTMLElement | null>(null) // 用于测量尺寸
const localContent = ref(props.data.content)

// 计算当前是否被高亮 (拖拽反馈)
const isTarget = computed(() => store.dragTargetId === id)
const intent = computed(() => isTarget.value ? store.dragIntent : null)

// 计算是否固定尺寸
const isFixedSize = computed(() => props.data.fixedSize)

// 注入快捷键
const selectedRef = toRef(props, 'selected')
useMindMapKeyboard(id, selectedRef, isEditing)

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
    nextTick(() => {
        textareaRef.value?.focus()
    })
}

// 2. 失焦保存
function onBlur() {
    isEditing.value = false
    if (localContent.value !== props.data.content) {
        store.updateNodeContent(id, localContent.value)
    }
}

// 3. 手动调整大小结束
function onResizeEnd(evt: any) {
    const { width, height } = evt.params
    // 这会将 fixedSize 置为 true，切换到固定模式
    store.updateNodeSize(id, { width, height })
}

const renderedMarkdown = computed(() => md.render(localContent.value))
</script>

<template>
    <div
        ref="containerRef"
        class="mind-map-node"
        :class="{
            'is-root': data.isRoot,
            'selected': selectedRef,
            'auto-size': !isFixedSize,
            'fixed-size': isFixedSize,
            'drag-over-child': isTarget && intent === 'child',
            'drag-over-above': isTarget && intent === 'above',
            'drag-over-below': isTarget && intent === 'below'
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

        <div v-show="showDebug" class="debug-info">
            <span>({{ Math.round(position.x) }}</span>
            <span>, {{ Math.round(position.y || 0) }}) </span>
            <span style="color: #ff4d4f">{{ id.substring(0,8) }}</span>
        </div>

        <div class="content-wrapper">

            <template v-if="isEditing">
                <div
                    v-if="!isFixedSize"
                    class="ghost-text"
                    aria-hidden="true">{{ localContent }}<br /></div>

                <textarea
                    ref="textareaRef"
                    v-model="localContent"
                    class="markdown-editor"
                    :class="{ 'absolute-fill': !isFixedSize }"
                    @blur="onBlur"
                    @mousedown.stop
                    @keydown.stop></textarea>
            </template>

            <div v-else class="markdown-body" v-html="renderedMarkdown"></div>
        </div>
    </div>
</template>

<style scoped>
.mind-map-node {
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
.mind-map-node.auto-size {
    width: fit-content;
    height: fit-content;
    min-width: 80px;
    max-width: 400px;
    /* 限制最大宽度，超过自动换行 */
}

/* === 模式 B: 固定大小 === */
.mind-map-node.fixed-size {
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
.mind-map-node.selected {
    border-color: #1890ff;
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
}

/* 根节点样式 */
.mind-map-node.is-root {
    background: #e6f7ff;
    border-color: #91d5ff;
    font-weight: bold;
    font-size: 16px;
}

.dark .mind-map-node.is-root {
    background: #111d2c;
    border-color: #177ddc;
}

/* 编辑器样式 */
.markdown-editor {
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    outline: none;
    resize: none;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    padding: 0;
    margin: 0;
    overflow: hidden;
    color: inherit;
}

/* 幽灵元素样式 (必须与 editor 一致) */
.ghost-text {
    visibility: hidden;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    grid-area: 1 / 1 / 2 / 2;
    /* 占据 Grid 第一格 */
}

/* 自动模式下，Textarea 绝对定位覆盖 Ghost */
.markdown-editor.absolute-fill {
    position: absolute;
    top: 0;
    left: 0;
}

/* Markdown 预览样式 */
.markdown-body {
    font-size: 14px;
    line-height: 1.5;
    word-wrap: break-word;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2) {
    margin: 0.2em 0;
    font-size: 1.2em;
    border-bottom: 1px solid var(--border-color);
}

.markdown-body :deep(p) {
    margin: 0;
}

.markdown-body :deep(ul) {
    padding-left: 20px;
    margin: 0;
}

/* Handle 样式 */
.io-handle {
    width: 4px;
    height: 4px;
    background: var(--handle-color);
    opacity: 0;
    transition: opacity 0.2s;
}

.mind-map-node:hover .io-handle,
.mind-map-node.selected .io-handle {
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


.debug-info {
    position: absolute;
    /* 向上偏移，数值等于标签高度 + 间距 */
    top: -20px;
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