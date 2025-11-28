<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import MarkdownIt from 'markdown-it'

// 引入缩放组件的默认样式
import '@vue-flow/node-resizer/dist/style.css'

// 1. 定义 Props (接收数据)
// 相当于 public 变量
interface NodeData {
    content: string
}
// VueFlow 会自动把节点的 props 传进来，包括 id, selected, data 等
const props = defineProps<NodeProps<NodeData>>()

// 2. 初始化 Markdown 引擎
const md = new MarkdownIt({ html: true, linkify: true, breaks: true })

// 3. 状态管理 (State)
const isEditing = ref(false) // 是否处于编辑模式
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const localContent = ref(props.data.content || '双击编辑 Markdown')

// 4. 计算属性：渲染 Markdown
const renderedMarkdown = computed(() => md.render(localContent.value))

// 5. 交互逻辑
// 双击进入编辑模式
function onDblClick(evt: MouseEvent) {
    evt.stopPropagation() // [重要] 阻止事件冒泡，防止触发画布的双击创建节点事件
    isEditing.value = true

    // 等待 DOM 更新出 textarea 后，立刻聚焦
    nextTick(() => {
        textareaRef.value?.focus()
    })
}

// 失去焦点时保存
function onBlur() {
    isEditing.value = false
    // 这里应该调用 props.data 的更新逻辑，或者通知 Store
    // 在 VueFlow 中，直接修改 data 对象通常是响应式的，但最佳实践是 updateNode
    props.data.content = localContent.value
}

const showDebug = ref(false)



</script>

<template>
    <div class="custom-node"
        @mouseenter="showDebug = true"
        @mouseleave="showDebug = false">
        <NodeResizer
            :is-visible="selected"
            :min-width="100"
            :min-height="50"
            line-class-name="my-resizer-line"
            handle-class-name="my-resizer-handle"
            :snap-grid="[20, 20]" />

        <Handle id="top" type="target" :position="Position.Top" class="my-handle" />
        <Handle id="right" type="source" :position="Position.Right" class="my-handle" />
        <Handle id="bottom" type="target" :position="Position.Bottom" class="my-handle" />
        <Handle id="left" type="source" :position="Position.Left" class="my-handle" />

        <div v-show="showDebug" class="debug-info">
            <span>({{ Math.round(position.x) }}</span>
            <span>, {{ Math.round(position.y || 0) }})</span>
            <span style="color: #ff4d4f">{{ id }}</span>
        </div>

        <div class="node-content" @dblclick="onDblClick">

            <textarea
                v-if="isEditing"
                ref="textareaRef"
                v-model="localContent"
                class="nodrag markdown-editor"
                @blur="onBlur"
                @mousedown.stop></textarea>

            <div
                v-else
                class="markdown-body"
                v-html="renderedMarkdown"></div>
        </div>
    </div>
</template>

<style scoped>
.custom-node {
    /* 节点的基础外观 */
    background: var(--node-bg);
    border: 1px solid var(--border-color);
    color: var(--text-color);
    border-radius: 8px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    min-width: 100px;
    min-height: 50px;
    /* 必须设置 100% 宽高，否则 NodeResizer 撑开了外层，但内容没跟上 */
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.node-content {
    flex-grow: 1;
    /* 填满剩余空间 */
    padding: 10px;
    overflow: hidden;
    /* 防止内容溢出 */
    text-align: left;
}

/* 编辑器样式 */
.markdown-editor {
    width: 100%;
    height: 100%;
    border: none;
    outline: none;
    resize: none;
    /* 禁止原生 textarea 的右下角拖拽，因为我们有 NodeResizer 了 */
    font-family: monospace;
    background: var(--node-bg);
    color: var(--text-color);
}

/* 预览样式 (简单模拟 Github Markdown 风格) */
.markdown-body :deep(h1) {
    font-size: 1.5em;
    border-bottom: 1px solid #eee;
}

.markdown-body :deep(p) {
    margin: 0.5em 0;
    line-height: 1.5;
}

.markdown-body :deep(code) {
    background: #eee;
    padding: 2px 4px;
    border-radius: 4px;
}

.markdown-body :deep(img) {
    max-width: 100%;
}

/* 自定义 Handle 样式 (让它平时不显眼，鼠标靠近才明显) */
.my-handle {
    width: 8px;
    height: 8px;
    background: #555;
    opacity: 1;
    /* 默认隐藏 */
    transition: opacity 0.2s;
}

.custom-node:hover .my-handle {
    opacity: 1;
    /* 鼠标悬停节点时显示端点 */
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