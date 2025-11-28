<script setup lang="ts">
import { ref, nextTick, onMounted, toRef, computed } from 'vue'
import { Handle, Position, useNode, type NodeProps } from '@vue-flow/core'
import { useCanvasStore } from '../stores/canvasStore'
import { useMindMapKeyboard } from '../composables/useMindMapShortcuts'



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

const selectedRef = toRef(props, 'selected')

// === 状态管理 ===
const isEditing = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const localContent = ref(props.data.content)


// === 注入快捷键逻辑 ===
// [!code focus] 一行代码接管所有键盘操作
useMindMapKeyboard(id, selectedRef, isEditing)

// === 交互逻辑 ===

// 1. 双击进入编辑模式
function onDblClick(evt: MouseEvent) {
    evt.stopPropagation() // 防止触发画布双击
    isEditing.value = true

    // 等待 DOM 渲染出 input 后聚焦
    nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select() // 全选文本，方便直接重写
    })
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
        <Handle
            v-if="!data.isRoot"
            type="target"
            :position="Position.Left"
            class="mind-handle" />

        <div class="node-content">
            <input
                v-if="isEditing"
                ref="inputRef"
                v-model="localContent"
                class="nodrag node-input"
                @blur="onBlur"
                @keydown.enter="onBlur"
                @mousedown.stop />

            <span v-else>{{ localContent }}</span>
        </div>

        <Handle
            type="source"
            :position="Position.Right"
            class="mind-handle" />
    </div>
</template>

<style scoped>
.mind-map-node {
    /* 类似于 Pill Shape */
    background: var(--node-bg);
    color: var(--text-color);
    border: 2px solid var(--border-color);
    border-radius: 8px;
    /* 圆角 */
    padding: 8px 16px;
    min-width: 60px;
    text-align: center;
    font-size: 14px;

    /* 关键：宽度自适应 */
    width: fit-content;

    /* 阴影 */
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.2s;

    /* 去掉 focus 时的默认蓝框 */
    outline: none;
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
    padding: 10px 20px;
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
</style>