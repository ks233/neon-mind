<script setup lang="ts">
import { ref, nextTick, onMounted, toRef, computed } from 'vue'
import { Handle, Position, useNode, type NodeProps } from '@vue-flow/core'
import { useCanvasStore } from '../stores/canvasStore'
import { useMindMapKeyboard } from '../composables/useMindMapShortcuts'

import MarkdownIt from 'markdown-it'

import { NodeResizer } from '@vue-flow/node-resizer'
import '@vue-flow/node-resizer/dist/style.css'

// 定义 Props (接收数据)
interface NodeData {
    content: string
    isRoot?: boolean // 只有根节点可能是特殊的
}
const props = defineProps<NodeProps<NodeData>>()

// 获取当前节点上下文 (GetComponent<Transform>)
const { id } = useNode()
const store = useCanvasStore()

// 计算当前是否被高亮
const isTarget = computed(() => store.highlightTargetId === id)
const intent = computed(() => isTarget.value ? store.highlightIntent : null)

// 从 props 转 ref 传给 hook
const selectedRef = toRef(props, 'selected')

// === 状态管理 ===
const isEditing = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const localContent = ref(props.data.content)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// === 注入快捷键逻辑 ===
useMindMapKeyboard(id, selectedRef, isEditing)

// === 渲染 Markdown ===
const md = new MarkdownIt({ html: true, linkify: true, breaks: true })
const renderedMarkdown = computed(() => md.render(localContent.value))

// === 交互逻辑 ===

// 1. 双击进入编辑模式
function onDblClick(evt: MouseEvent) {
    evt.stopPropagation()
    isEditing.value = true
    nextTick(() => textareaRef.value?.focus())
}

// 2. 失去焦点或回车时保存
function onBlur() {
    isEditing.value = false
    // 如果内容变了，通知 Store 更新 (View -> Model)
    if (localContent.value !== props.data.content) {
        store.updateNodeContent(id, localContent.value)
        // 只有内容变长导致尺寸变化时，才需要触发重排，这里暂时省略
        // store.syncModelToView() 
    }
}

// 3. [核心] 调整大小结束
// 这里的 props 类型来自 NodeResizer 的回调
function onResizeEnd(evt: any) {
    // params: { x, y, width, height }
    const { width, height } = evt.params
    console.log('Resize End:', width, height)

    // 保存到 Model 并触发 ELK 重排
    store.updateNodeSize(id, { width, height })
}
</script>

<template>
    <div
        class="mind-map-node"
        :class="{
            'is-root': data.isRoot, 'selected': selected,
            'drag-over-child': isTarget && intent === 'child',
            'drag-over-above': isTarget && intent === 'above',
            'drag-over-below': isTarget && intent === 'below'
        }"
        @dblclick="onDblClick"
        tabindex="0">
        <NodeResizer
            :is-visible="selected"
            :min-width="100"
            :min-height="40"
            :snap-grid="[20, 20]"
            @resize-end="onResizeEnd" />
        <Handle id="left" type="target" :position="Position.Left" class="io-handle" />
        <Handle id="top" type="target" :position="Position.Top" class="io-handle" />
        <Handle id="right" type="source" :position="Position.Right" class="io-handle" />
        <Handle id="bottom" type="source" :position="Position.Bottom" class="io-handle" />

        <div class="node-content">
            <textarea
                v-if="isEditing"
                ref="textareaRef"
                v-model="localContent"
                class="markdown-editor"
                @blur="onBlur"
                @mousedown.stop
                @keydown.stop></textarea>
            <div
                v-else
                class="markdown-body"
                v-html="renderedMarkdown"></div>
        </div>

        <Handle
            type="source"
            :position="Position.Right"
            class="mind-handle" />
    </div>
</template>

<style scoped>
.mind-map-node {
    background: var(--node-bg);
    border: 2px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-color);

    /* 关键：不再使用 fit-content */
    /* 因为现在尺寸由 VueFlow (style.width/height) 控制 */
    width: 100%;
    height: 100%;

    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* 防止内容溢出边框 */
    transition: box-shadow 0.2s;
}

/* 选中状态 */
.mind-map-node.selected {
    border-color: #1890ff;
    /* Unity Blue */
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
}

/* 根节点特殊样式 (加粗、变大) */
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
.node-input {
    width: 100px;
    /* 给个最小宽度 */
    background: transparent;
    border: none;
    outline: none;
    color: inherit;
    font-size: inherit;
    text-align: center;
    padding: 0;
    margin: 0;
}

/* 把 Handle 隐藏起来，或者做得非常小 */
/* 自动布局的导图通常不需要用户手动连线 */
.mind-handle {
    opacity: 0;
    /* 甚至可以直接隐藏 */
    width: 1px;
    height: 1px;
}


/* 拖拽反馈样式 */

/* 意图：成为子节点 -> 整个边框变蓝 */
.drag-over-child {
    box-shadow: 0 0 0 3px #1890ff !important;
    background-color: rgba(24, 144, 255, 0.1);
}

/* 意图：插到上方 -> 顶部出现红线 */
.drag-over-above {
    border-top: 3px solid #ff4d4f !important;
}

/* 意图：插到下方 -> 底部出现红线 */
.drag-over-below {
    border-bottom: 3px solid #ff4d4f !important;
}

/* 编辑器填满空间 */
.markdown-editor {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  outline: none;
  resize: none; /* 禁用原生右下角拖拽，用 NodeResizer */
  color: inherit;
}

/* 简单的 Markdown 样式 */
.markdown-body :deep(h1), 
.markdown-body :deep(h2) {
  margin: 0.2em 0;
  font-size: 1.2em;
  border-bottom: 1px solid var(--border-color);
}
.markdown-body :deep(p) { margin: 0; }
.markdown-body :deep(ul) { padding-left: 20px; margin: 0; }

/* Handle 样式：平时隐藏，hover或选中时显示 */
.io-handle {
    width: 8px;
    height: 8px;
    background: var(--handle-color);
    opacity: 0;
    transition: opacity 0.2s;
}

.mind-map-node:hover .io-handle,
.mind-map-node.selected .io-handle {
    opacity: 1;
}

.node-content {
    flex: 1;
    padding: 8px 12px;
    overflow-y: auto;
    /* 内容太多出滚动条 */
    font-size: 14px;
    line-height: 1.5;
    text-align: left;
    /* Markdown 通常靠左 */
    overflow: hidden;
}
</style>