<script setup lang="ts">
import { useMindMapKeyboard } from '@/composables/useMindMapShortcuts'
import { NODE_CONSTANTS } from '@/config/layoutConfig'
import { useCanvasStore } from '@/stores/canvasStore'
import { useUiStore } from '@/stores/uiStore'
import { ImagePayload, LogicNode, MarkdownPayload } from '@/types/model'
import { resolveContentComponent } from '@/utils/contentResolver'
import { snapToGrid } from '@/utils/grid'
import { GraphNode, Handle, Position, useNode, useVueFlow, type NodeProps } from '@vue-flow/core'
import { NodeResizer, OnResize, OnResizeStart } from '@vue-flow/node-resizer'
import '@vue-flow/node-resizer/dist/style.css'
import { useResizeObserver } from '@vueuse/core'
import flourite from 'flourite'
import { computed, ref, toRef } from 'vue'

// 定义 Props
interface NodeData {
    logicNode: LogicNode
    isRoot?: boolean
    fixedSize?: boolean // 标记是否已被手动调整过大小
}
const props = defineProps<NodeProps<NodeData>>()

// 初始化 composables
const { id, node } = useNode()
const canvasStore = useCanvasStore()
const uiStore = useUiStore()

// 元素引用，用于测量尺寸
const containerRef = ref<HTMLElement | null>(null)

// 状态
const showDebug = ref(false)
const isEditing = computed({
    get() {
        return uiStore.editingNodeId === id
    },
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
// 拖拽反馈
const isDetaching = computed(() => uiStore.dragDetachId === id && uiStore.dragIntent === null)
const isTarget = computed(() => uiStore.dragTargetId === id)
const intent = computed(() => isTarget.value ? uiStore.dragIntent : null)
const isCarried = computed(() => uiStore.carriedNodeIds.has(id))

// 计算是否固定尺寸
const isFixedSize = computed(() => props.data.fixedSize || node.resizing)
const selectedRef = toRef(props, 'selected')

// 内容类型（Markdown、图片、链接）
const ContentComponent = computed(() =>
    resolveContentComponent(props.data.logicNode.contentType)
)

// 注入快捷键（Alt+上下）
useMindMapKeyboard(id, selectedRef, isEditing)


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

// 双击进入编辑
function onDblClick(evt: MouseEvent) {
    evt.stopPropagation()
    isEditing.value = true
}

// 内容节点更新
function handleUpdate(type: 'content' | 'url' | 'ratio' | 'language', val: any) {
    switch (type) {
        case 'content':
            canvasStore.updateNodeContent(id, val);
            break;
        case 'url':
            canvasStore.updateNodeLink(id, val);
            break;
        case 'ratio':
            // 图片加载完成后更新比例，用于排版
            canvasStore.updateNodeData(id, { ratio: val });
            break;
        case 'language':
            // ContentMarkdown 代码模式语言变更
            canvasStore.updateNodeData(id, { language: val });
            break;
    }
}

let resizeStartDim = { width: 0, height: 0 }

function onResizeStart(evt: OnResizeStart) {
    const { width, height } = evt.params
    resizeStartDim = { width, height }
}

function onResize(evt: OnResize) {

}

// 3. 手动调整大小结束
function onResizeEnd(evt: OnResizeStart) {
    if (isImage.value) {
        canvasStore.updateNodeSize(
            id,
            { width: node.dimensions.width, height: node.dimensions.height },
            { x: snapToGrid(node.position.x), y: snapToGrid(node.position.y) }
            , true)
        return;
    }
    // 这会将 fixedSize 置为 true，切换到固定模式
    const deltaWidth = resizeStartDim.width - evt.params.width
    const deltaHeight = resizeStartDim.height - evt.params.height
    if (deltaWidth ** 2 + deltaHeight ** 2 < 10 ** 2) {
        node.dimensions.width = resizeStartDim.width
        node.dimensions.height = resizeStartDim.height
        canvasStore.syncModelToView()
        return
    }
    const { width, height } = evt.params

    const snappedWidth = snapToGrid(width)
    const snappedHeight = snapToGrid(height)

    const finalWidth = Math.max(100, snappedWidth) // 100 是最小宽度
    const finalHeight = Math.max(40, snappedHeight)

    node.dimensions.width = finalWidth
    node.dimensions.height = finalHeight
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

    // 2. 如果别人正在编辑，立刻帮他关闭！
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
const isCode = computed(() =>
    props.data.logicNode.contentType === 'markdown' &&
    props.data.logicNode.language &&
    props.data.logicNode.language !== '')

//#region 右键菜单
const contextMenu = ref({
    show: false,
    x: 0,
    y: 0
})

function onContextMenu(e: MouseEvent) {
    // 仅针对 Markdown 类型显示
    if (props.data.logicNode.contentType !== 'markdown') {
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    contextMenu.value = {
        show: true,
        x: e.clientX,
        y: e.clientY
    }
}

function closeContextMenu() {
    contextMenu.value.show = false;
}


// 修改 toggleCodeMode 函数
async function toggleCodeMode() {
    const payload = props.data.logicNode as MarkdownPayload;
    // 判断当前是否是代码模式
    const isCode = !!payload.language && payload.language !== 'markdown';

    let targetLanguage: string | undefined = undefined;

    if (!isCode) {
        // === 准备切换为代码模式：自动检测语言 ===
        const content = payload.content || '';

        // 只有内容不为空时才检测，否则默认 javascript
        if (content.trim()) {
            try {
                const result = flourite(content); // 自动检测语言
                targetLanguage = result.language.toLowerCase() || 'javascript';
            } catch (e) {
                console.warn('Language detection failed:', e);
                targetLanguage = 'javascript';
            }
        } else {
            targetLanguage = 'javascript';
        }
    } else {
        // === 准备切换回 Markdown ===
        targetLanguage = undefined;
    }

    // 更新数据
    canvasStore.updateNodeData(id, {
        language: targetLanguage
    });

    closeContextMenu();
}
//#endregion

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
            'is-image': isImage,
            'is-code': isCode
        }"
        @dblclick="onDblClick"
        :style="nodeStyles"
        @mouseenter="showDebug = true"
        @mouseleave="showDebug = false"
        @mousedown.prevent="handleMouseDown"
        @contextmenu="onContextMenu">

        <NodeResizer
            :is-visible="true"
            :min-width="100"
            :min-height="40"
            :snap-grid="[20, 20]"
            :keep-aspect-ratio="isImage"

            line-class-name="invisible-resizer-line"
            handle-class-name="invisible-resizer-handle"
            @resize-start="onResizeStart"
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
                @update:ratio="(v: any) => handleUpdate('ratio', v)"
                @update:language="(v: any) => handleUpdate('language', v)" />
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
        <!-- 右键菜单 -->
        <Teleport to="body">
            <div v-if="contextMenu.show" class="context-menu-overlay" @click="closeContextMenu"
                @contextmenu.prevent="closeContextMenu">
                <div class="node-context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
                    @click.stop>
                    <div class="menu-item" @click="toggleCodeMode">
                        <span class="icon">
                            {{ (data.logicNode as MarkdownPayload).language ? 'M↓' : '{}' }}
                        </span>
                        <span class="label">
                            {{ (data.logicNode as MarkdownPayload).language ? '转换为 Markdown' : '转换为代码块' }}
                        </span>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<style lang="scss" scoped>
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

    &.auto-size {
        width: fit-content;
        height: fit-content;
        min-width: 100px;
        min-height: 40px;
        max-width: var(--converted-max-width); // 限制最大宽度，超过自动换行
    }

    &.is-image {
        padding: 0;
        border-radius: 0;
    }

    &.is-code.auto-size {
        min-height: 60px;
        max-width: none;
    }

    &.is-image.auto-size {
        min-width: var(--converted-max-width);
    }

    &.dragging {
        opacity: 0.3;
    }

    &.is-detaching {
        // border-color: #18ffcd !important;
        border-style: dashed !important;
        box-shadow: 0 0 10px 0px var(--border-color) !important;
        opacity: 1;
    }

    &.fixed-size {
        // 宽高由 Vue Flow style 控制，这里强制填满
        width: 100%;
        height: 100%;
    }

    &.selected {
        box-shadow: 0 0 0 3px var(--border-color);
    }

    &.is-editing {
        box-shadow: 0 0 0 5px var(--border-color);
    }

    &.is-carried {
        opacity: 0.5; // 半透明
        pointer-events: none; // 拖拽父节点时，禁止子节点响应鼠标，防误触
        transition: opacity 0.2s; // 增加一点渐变动效
    }

    &::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none; // 鼠标穿透
        border: 0 solid transparent; // 默认无边框
        transition: border-color 0.1s, box-shadow 0.1s;
        z-index: 100;
        border-radius: inherit; // 跟随圆角
    }

    // 拖拽反馈样式
    &.drag-over-child::after {
        box-shadow: inset -5px 0px var(--border-color);
    }

    &.drag-over-above::after {
        box-shadow: inset 0px 6px 0px var(--border-color);
    }

    &.drag-over-below::after {
        box-shadow: inset 0px -6px 0px var(--border-color);
    }
}

.content-wrapper {
    flex: 1;
    position: relative;
    display: grid;
    min-height: 24px;
    padding: 0;
    overflow: hidden;

    &.is-image {
        padding: 0;
        border-radius: 0;
    }
}

// Handle 样式
.io-handle {
    width: 6px;
    height: 6px;
    background-color: var(--border-color);
    opacity: 0;
    transition: opacity 0.1s;

    // z-index: -100;
    // 使用伪元素扩大判定范围
    &::after {
        content: '';
        position: absolute;

        top: -8px;
        bottom: -8px;
        left: -8px;
        right: -8px;

        // 调试用：如果想看到热区，可以取消下面这行的注释
        // background: rgba(255, 255, 255, 0.1);

        z-index: -100;
        border-radius: 50%; // 热区也设为圆形，手感更好
    }

    &:hover {
        opacity: 1;
    }

}

// 强制隐藏线条
:deep(.invisible-resizer-line) {
    border-color: #fff;
    opacity: 0 !important;
    z-index: -105;

    &.selected {
        border-color: #fff;
        z-index: 105;
    }

    &.right {
        border-right-width: 6px;
    }

    &.left {
        border-left-width: 6px;
    }

    &.top {
        border-top-width: 6px;
    }

    &.bottom {
        border-bottom-width: 6px;
    }
}

// 强制隐藏手柄，但保留鼠标交互
:deep(.invisible-resizer-handle) {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: transparent !important;
    border: none !important;
    // background: var(--border-color) !important;
    // 关键：虽然看不见，但鼠标放上去要变光标，且能点击
    // VueFlow 默认样式已经处理了 cursor，这里只要确保它不透明度为0即可
    z-index: -104;

    &.selected {
        z-index: 106;
    }
}



.debug-info {
    position: absolute;
    // background: rgba(0, 0, 0, 0.85);
    color: #ffffff5d;
    top: 100%;
    margin-top: 0px;
    padding: 4px 0px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
    // 禁止换行
    pointer-events: none;
    // 鼠标穿透，不挡操作
    z-index: 9999;
    // 确保浮在所有东西上面
    // 留一点间隙
    // 可选：加个小阴影
    // box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

// 右键菜单
.context-menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999; // 确保在最顶层
    background: transparent;
}

.node-context-menu {
    position: fixed;
    background: var(--node-bg, #fff);
    border: 1px solid var(--border-color, #ccc);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4px;
    min-width: 140px;
    z-index: 10000; // 简单的入场动画
    animation: menu-fade-in 0.1s ease-out;

    .menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        cursor: pointer;
        border-radius: 4px;
        font-size: 13px;
        color: var(--text-color);
        transition: background-color 0.1s;

        &:hover {
            background-color: rgba(0, 0, 0, 0.05);
        }
    }

    .icon {
        font-family: 'JetBrains Mono';
        opacity: 0.7;
        width: 16px;
        text-align: center;
    }
}


@keyframes menu-fade-in {
    from {
        opacity: 0;
        transform: scale(0.95);
    }

    to {
        opacity: 1;
        transform: scale(1);
    }
}
</style>