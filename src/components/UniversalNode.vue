<script setup lang="ts">
import { useMindMapKeyboard } from '@/composables/useMindMapShortcuts'
import { useCanvasStore } from '@/stores/canvasStore'
import { GraphNode, Handle, Position, useNode, useVueFlow, type NodeProps } from '@vue-flow/core'
import { NodeResizer, OnResize, OnResizeStart } from '@vue-flow/node-resizer'
import '@vue-flow/node-resizer/dist/style.css'
import { useResizeObserver } from '@vueuse/core'
import { computed, ref, toRef } from 'vue'
import { NODE_CONSTANTS } from '@/config/layoutConfig'

// 定义 Props
interface NodeData {
    logicNode: LogicNode
    isRoot?: boolean
    fixedSize?: boolean // 标记是否已被手动调整过大小
}
const props = defineProps<NodeProps<NodeData>>()
const showDebug = ref(false)
const isDetaching = computed(() => uiStore.dragDetachId === id && uiStore.dragIntent === null)

const { id, node } = useNode()
const canvasStore = useCanvasStore()
const uiStore = useUiStore()

import { useUiStore } from '@/stores/uiStore'
import { ImagePayload, LogicNode } from '@/types/model'
import { resolveContentComponent } from '@/utils/contentResolver'
import { snapToGrid } from '@/utils/grid'

// === 状态管理 ===
const isEditing = computed({
    // 读取：判断全局的"令牌"是不是在自己手里
    get() {
        return uiStore.editingNodeId === id
    },
    // 写入：修改本地变量时，自动代理到 Store Action
    set(val: boolean) {
        if (val) {
            uiStore.startEditing(id)
        } else {
            // 只有当当前编辑的是自己时，才有权取消
            // (防止某些边缘情况误关了别人的编辑态)
            if (uiStore.editingNodeId === id) {
                uiStore.stopEditing()
            }
        }
    }
})
const containerRef = ref<HTMLElement | null>(null) // 用于测量尺寸

// 计算当前是否被高亮 (拖拽反馈)
const isTarget = computed(() => uiStore.dragTargetId === id)
const intent = computed(() => isTarget.value ? uiStore.dragIntent : null)
const isCarried = computed(() => uiStore.carriedNodeIds.has(id))


// 计算是否固定尺寸
const isFixedSize = computed(() => props.data.fixedSize || node.resizing)

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
        canvasStore.reportAutoContentSize(id, { width, height })
    }
})

// === 交互逻辑 ===

// 1. 双击进入编辑
function onDblClick(evt: MouseEvent) {
    evt.stopPropagation()
    isEditing.value = true
}

function handleUpdate(type: 'content' | 'url' | 'ratio', val: any) {
    switch (type) {
        case 'content':
            canvasStore.updateNodeContent(id, val);
            break;
        case 'url':
            // 这里可以触发一个异步 Action 去爬取 og:image
            canvasStore.updateNodeLink(id, val);
            break;
        case 'ratio':
            // 图片加载完成后更新比例，用于排版
            canvasStore.updateNodeData(id, { ratio: val });
            break;
    }
}

function onResize(evt: OnResize) {
    if (isImage.value) return;
    const { width, height } = evt.params

    const snappedWidth = snapToGrid(width)
    const snappedHeight = snapToGrid(height)

    const finalWidth = Math.max(100, snappedWidth) // 100 是最小宽度
    const finalHeight = Math.max(40, snappedHeight)

    node.dimensions.width = finalWidth
    node.dimensions.height = finalHeight
}

// 3. 手动调整大小结束
function onResizeEnd(evt: OnResizeStart) {
    // 这会将 fixedSize 置为 true，切换到固定模式
    onResize(evt as OnResize)
    canvasStore.updateNodeSize(
        id,
        { width: node.dimensions.width, height: node.dimensions.height },
        { x: snapToGrid(node.position.x), y: snapToGrid(node.position.y) }
    )
}

function handleMouseDown(e: MouseEvent) {
    // 1. 如果自己正在编辑，绝对不要拦截！
    // 否则用户无法点击编辑器内部来移动光标或选中文本
    if (isEditing.value) {
        // e.stopPropagation(); // 可选：如果你不想让 Vue Flow 选中节点，可以加这行，但通常不需要
        return;
    }

    // 2. [核心修复] 如果别人正在编辑，立刻帮他关闭！
    // 因为我们下面要 preventDefault，浏览器不会自动 blur 那个节点，所以我们要手动通过 Store 关闭它
    if (uiStore.editingNodeId && uiStore.editingNodeId !== id) {
        uiStore.stopEditing();
    }

    // 3. 阻止默认行为（防止当前节点获得 DOM 焦点，解决 Tab 乱跳问题）
    // 这行代码必须保留
    e.preventDefault();
}


const { addSelectedNodes, removeSelectedNodes, getSelectedNodes, findNode } = useVueFlow()

async function onContentCommand(key: string) {
    if (key === 'Tab') {
        const newIds = await canvasStore.addMindMapChildBatch([id])
        if (newIds.length == 1) {
            const newNode = findNode(newIds[0]) as GraphNode
            removeSelectedNodes([newNode])
            addSelectedNodes([newNode])
            uiStore.startEditing(newIds[0])
        }
    } else if (key === 'Enter') {
        // 允许 Shift+Enter 换行 (已经在子组件过滤了吗？最好在子组件处理)
        // 我们的子组件逻辑是全拦截，所以这里直接执行
        isEditing.value = false;
    }
}

const nodeStyles = computed(() => {
    const scale = props.data.logicNode.contentScale || 1

    const baseMaxWidth = NODE_CONSTANTS.MAX_WIDTH

    return {
        '--converted-max-width': (baseMaxWidth * scale) + 'px'
    }
})

const isImage = computed(() => props.data.logicNode.contentType === 'image')

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
            'dragging': dragging || isCarried,
            'is-detaching': isDetaching,
            'is-editing': isEditing,
            'is-image': isImage
        }"
        @dblclick="onDblClick"
        :style="nodeStyles"
        @mouseenter="showDebug = true"
        @mouseleave="showDebug = false"
        @mousedown.prevent="handleMouseDown">

        <NodeResizer
            :is-visible="true"
            :min-width="100"
            :min-height="40"
            :snap-grid="[20, 20]"
            :keep-aspect-ratio="isImage"
            line-class-name="invisible-resizer-line"
            handle-class-name="invisible-resizer-handle"
            @resize="onResize"
            @resize-end="onResizeEnd" />

        <Handle id="left" type="source" :position="Position.Left" class="io-handle" />
        <Handle id="top" type="source" :position="Position.Top" class="io-handle" />
        <Handle id="right" type="source" :position="Position.Right" class="io-handle" />
        <Handle id="bottom" type="source" :position="Position.Bottom" class="io-handle" />

        <div class="content-wrapper"
            :class="{
                'is-image': isImage
            }">
            <component
                :is="ContentComponent"
                :data="(data.logicNode as any)"
                :fixed-size="isFixedSize"
                :is-editing="isEditing"

                :style="{
                    zoom: data.logicNode.contentScale || 1
                }"
                @blur="isEditing = false"
                @command="onContentCommand"
                @update:content="(v: any) => handleUpdate('content', v)"
                @update:url="(v: any) => handleUpdate('url', v)"
                @update:ratio="(v: any) => handleUpdate('ratio', v)" />
        </div>

        <div v-show="showDebug" class="debug-info">
            <span>x:{{ Math.round(position.x) }}, y:{{ Math.round(position.y || 0) }}, </span>
            <span> w:{{ Math.round(dimensions.width) }}, h:{{ Math.round(dimensions.height || 0) }}, </span>
            <span>id: {{ id.substring(0, 8) }}</span><br>
            <!-- <span>z: {{ node.zIndex }}</span> -->
            <template v-if="data.logicNode.contentType == 'image'">
                <span> runtimePath: {{ (data.logicNode as ImagePayload).runtimePath }}</span><br>
                <span> relativePath: {{ (data.logicNode as ImagePayload).relativePath }}</span>
            </template>
            <!-- {{ data.logicNode.width }} -->
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
    transition: box-shadow 0.2s, border-color 0.1s, background-color 0.1s, opacity 0.2s;
}

/* === 模式 A: 自动大小 === */
.universal-node.auto-size {
    width: fit-content;
    height: fit-content;
    min-width: 100px;
    min-height: 40px;
    max-width: var(--converted-max-width);
    /* 限制最大宽度，超过自动换行 */
}

.content-wrapper.is-image {
    padding: 0;
    border-radius: 0;
}

.universal-node.is-image {
    padding: 0;
    border-radius: 0;
    max-width: none;
}

/* === 模式 B: 固定大小 === */
.universal-node.fixed-size {
    /* 宽高由 Vue Flow style 控制，这里强制填满 */
    width: 100%;
    height: 100%;
}

.universal-node.dragging {
    opacity: 0.3;
}

.universal-node.is-detaching {
    /* border-color: #18ffcd !important; */
    border-style: dashed !important;
    box-shadow: 0 0 10px 0px var(--border-color) !important;
    opacity: 1;
}

.content-wrapper {
    flex: 1;
    position: relative;
    display: grid;
    min-height: 24px;
    padding: 6px 8px;
    padding-bottom: 2px;
    overflow: hidden;
}

/* 选中状态 */
.universal-node.selected {
    /* border-color: #1890ff; */
    box-shadow: 0 0 0 3px var(--border-color);
}

.universal-node.is-editing {
    /* border-color: #1890ff; */
    box-shadow: 0 0 0 5px var(--border-color);
}

/* 根节点样式 */
.universal-node.is-root {
    /* background: #e6f7ff; */
    /* border-color: #91d5ff; */
}

.dark .universal-node.is-root {
    /* background: #111d2c; */
    /* border-color: #177ddc; */
}

.universal-node.is-carried {
    opacity: 0.5;
    /* 半透明 */
    pointer-events: none;
    /* [可选] 拖拽父节点时，禁止子节点响应鼠标，防误触 */
    transition: opacity 0.2s;
    /* 增加一点渐变动效 */
}

/* Handle 样式 */
.io-handle {
    width: 6px;
    height: 6px;
    background: var(--border-color);
    opacity: 0;
    transition: opacity 0.2s;
    z-index: -100;
}

/* [核心代码] 使用伪元素扩大判定范围 */
.io-handle::after {
    content: '';
    position: absolute;

    top: -8px;
    bottom: -8px;
    left: -8px;
    right: -8px;

    /* 调试用：如果想看到热区，可以取消下面这行的注释 */
    background: rgba(255, 255, 255, 0.1);

    border-radius: 50%;
    /* 热区也设为圆形，手感更好 */
}

.universal-node:hover .io-handle,
.universal-node.selected .io-handle {
    /* opacity: 1; */
}

/* 额外优化：当鼠标悬停在 Handle 的"热区"上时，让 Handle 稍微变大一点点作为反馈 */
.io-handle:hover {
    /* 视觉反馈 */
    opacity: 1;
    background: #1890ff;
    /* 激活色 */
}


.universal-node::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    /* 鼠标穿透 */
    border: 0 solid transparent;
    /* 默认无边框 */
    transition: border-color 0.1s, box-shadow 0.1s;
    z-index: 100;
    border-radius: inherit;
    /* 跟随圆角 */
}

/* 拖拽反馈样式 */
.drag-over-child::after {
    box-shadow: inset -5px 0px var(--border-color);
    /* background-color: color-mix(in srgb, var(--node-bg), transparent 20%); */
}

.drag-over-above::after {
    /* border-top: 6px solid var(--border-color) !important; */
    /* x y 羽化 扩展 */
    box-shadow: inset 0px 6px 0px var(--border-color);
}

.drag-over-below::after {
    /* border-bottom: 6px solid var(--border-color) !important; */
    box-shadow: inset 0px -6px 0px var(--border-color);
}

.drag-over-above,
.drag-over-below {
    /* background-color: color-mix(in srgb, var(--node-bg), transparent 20%); */
    /* box-shadow: 0 0 0 2px var(--border-color) !important; */
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
    /* background: rgba(0, 0, 0, 0.85); */
    color: #ffffff5d;
    top: 100%;
    margin-top: 0px;
    padding: 4px 0px;
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
    /* 留一点间隙 */
    /* 可选：加个小阴影 */
    /* box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2); */
}
</style>