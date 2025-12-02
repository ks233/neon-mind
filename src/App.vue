<script setup lang="ts">
import { ref, computed, markRaw, nextTick } from 'vue'
import { VueFlow, useVueFlow, SelectionMode } from '@vue-flow/core'
import type { Connection, NodeTypesObject, Node, Edge, GraphEdge, EdgeMouseEvent, NodeRemoveChange, NodeDragEvent, NodeChange, EdgeChange, GraphNode } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'

// 必须引入 Vue Flow 的默认样式，否则节点会乱飞
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import OriginNode from '@/components/OriginNode.vue'

import { useCanvasStore } from '@/stores/canvasStore'

import { useDark, useToggle } from '@vueuse/core'

import { snapToGrid } from '@/utils/grid'
import UniversalNode from '@/components/UniversalNode.vue'
import { useGlobalInteractions } from './composables/useGlobalInteractions'
import { useGlobalShortcuts } from './composables/useGlobalShortcuts'

// #region 初始化

// 自定义节点
const nodeTypes: NodeTypesObject = {
    origin: markRaw(OriginNode as any),
    markdown: markRaw(UniversalNode),
    'mindmap': markRaw(UniversalNode),
    'Universal': markRaw(UniversalNode),
}

useGlobalInteractions()

useGlobalShortcuts()

// 数据单例
const store = useCanvasStore()

// VueFlow 工具函数
const { screenToFlowCoordinate, addEdges, updateEdge, getEdges } = useVueFlow()

const gridSize = ref<number>(20)
const DETACH_DISTANCE = 60;
// #endregion

// #region 深色模式

// useDark 会自动检测系统偏好，并给 <html> 标签添加 'dark' class
const isDark = useDark()
const toggleDark = useToggle(isDark)

// 计算属性：根据模式返回网格颜色 (Hex值)
// 相当于在 Update() 里动态修改 Material 颜色
const gridColor = computed(() => isDark.value ? '#3a3a3a' : '#e5e5e5')
const edgeColor = computed(() => isDark.value ? '#666' : '#b1b1b7')

// #endregion

// #region 创建节点

function onDblClick(event: MouseEvent) {
    const target = event.target as Element
    const isNode = target.closest('.vue-flow__node')
    const isEdge = target.closest('.vue-flow__edge')

    // 如果点到了节点或者线，直接返回，不要生成新节点
    if (isNode || isEdge) {
        return
    }

    // 只有点在空地上，才执行生成逻辑
    const { x, y } = screenToFlowCoordinate({
        x: event.clientX,
        y: event.clientY,
    })

    const rawX = x - 0 // 减去宽度一半
    const rawY = y - 0  // 减去高度一半

    const finalX = snapToGrid(rawX, gridSize.value)
    const finalY = snapToGrid(rawY, gridSize.value)

    // 修正坐标中心（可选）
    store.addMindMapRoot(finalX, finalY)


    // 阻止默认行为（防止选中文字等）
    event.preventDefault()
}

// #endregion

// #region 监听变化

function onConnect(params: Connection) {
    // params 包含了 source(起点ID), target(终点ID), sourceHandle(起点端点ID) 等信息
    // addEdge 是官方提供的工具，它会自动处理去重，并生成 edge 对象
    addEdges(params)
    store.createConnection(params)
}

// 当用户按 Delete 键时，Vue Flow 会先更新视图，然后触发这个回调
function onNodesChange(changes: NodeChange[]) {
    changes.forEach((change) => {
        if (change.type === 'remove') {
            console.log('检测到节点删除:', change.id)
            store.removeNodeFromModel(change.id)
        }
    })
}

function onEdgesChange(changes: EdgeChange[]) {
    changes.forEach(change => {
        if (change.type === 'remove') {
            store.removeEdge(change.id)
        }
    })
}

// #endregion

// #region 更新连线

const isUpdateSuccessful = ref(false)

function onEdgeUpdateStart(edge: EdgeMouseEvent) {
    isUpdateSuccessful.value = false
}

function onEdgeUpdate({ edge, connection }: { edge: GraphEdge, connection: Connection }) {
    // edge: 被拖拽的那根旧线对象
    // connection: 新的连接信息 (包含了新的 source 或 target)

    // updateEdge 是官方提供的 Helper
    // 它会自动在 store.edges 数组里找到 oldEdge，把它替换成新的连接关系
    // 并返回一个新的数组
    isUpdateSuccessful.value = true
    updateEdge(edge, connection)
    store.updateEdgeConnection(edge, connection)
}

// 拖拽到空地时删除边
function onEdgeUpdateEnd(params: EdgeMouseEvent) {
    const { edge } = params
    if (!isUpdateSuccessful.value) {
        store.removeEdge(edge.id)
    }
    // 重置状态（可选，为了保险）
    isUpdateSuccessful.value = false
}

// #endregion

// #region 拖拽改变导图层级

const { getIntersectingNodes, findNode } = useVueFlow()

const dragStartPos = ref({ x: 0, y: 0 })

function onNodeDragStart(e: NodeDragEvent) {
    dragStartPos.value = { x: e.node.position.x, y: e.node.position.y }
}
// 1. 拖拽中 (Update Loop)
function onNodeDrag(e: NodeDragEvent) {
    // 只处理单选拖拽，且拖拽的是思维导图节点
    const draggedNode = e.node
    const draggedId = draggedNode.id

    const logicNode = store.model.nodes[draggedId]

    // 获取所有与拖拽节点发生碰撞的节点
    // getIntersectingNodes 类似于 Unity Physics.OverlapBox
    const intersections = getIntersectingNodes(draggedNode)

    // 过滤：只关心思维导图节点，且忽略自己和自己的子孙(可选，store里有校验)
    const targetNode = intersections.find(n => n.id !== draggedNode.id && n.id !== 'world-origin')

    if (targetNode) {
        // 更新 Store 的 UI 状态
        store.dragTargetId = targetNode.id
        store.dragIntent = calculateIntent(draggedNode, targetNode)
        store.dragDetachId = null
    } else {
        store.dragTargetId = null
        store.dragIntent = null
    }
    const parentNode = findNode(logicNode.parentId)
    if (parentNode) {
        const dx = draggedNode.position.x - dragStartPos.value.x
        const dy = draggedNode.position.y - dragStartPos.value.y
        // 欧几里得距离
        const distance = Math.sqrt(dx * dx + dy * dy)

        // 3. 判断阈值
        if (distance > DETACH_DISTANCE) {
            store.dragDetachId = draggedId
        } else {
            store.dragDetachId = null
        }
    }

}

// 2. 拖拽结束 (OnMouseUp)
function onNodeDragStop(e: NodeDragEvent) {
    const draggedNode = e.node
    e.nodes.forEach((node) => {
        // 同步回 Store
        if (store.dragTargetId && store.dragIntent) {
            console.log(`Moving ${draggedNode.id} -> ${store.dragTargetId} (${store.dragIntent})`)
            // 调用 Store 执行逻辑
            store.moveMindMapNodeTo(node.id, store.dragTargetId, store.dragIntent)
        } else if (store.dragDetachId === node.id) {
            store.detachNode(node.id, node.position)
        } else {
            store.updateNodePosition(node.id, node.position)
        }
    })
    // 清理状态
    store.dragTargetId = null
    store.dragIntent = null
    store.dragDetachId = null
    dragStartPos.value = { x: 0, y: 0 }
}

// 辅助：计算意图 (简单的 AABB 区域判断)
function calculateIntent(source: GraphNode, target: GraphNode): 'child' | 'above' | 'below' {
    // 我们比较 source 的中心点 和 target 的 Geometry
    const sourceCenterY = source.position.y + (source.dimensions.height || 0) / 2

    const targetTop = target.position.y
    const targetHeight = target.dimensions.height || 0
    const targetBottom = targetTop + targetHeight

    // 定义阈值：上下 25% 区域用于排序，中间 50% 用于成为子节点
    const zoneHeight = targetHeight * 0.25

    if (sourceCenterY < targetTop + zoneHeight) {
        return 'above' // 命中顶部
    } else if (sourceCenterY > targetBottom - zoneHeight) {
        return 'below' // 命中底部
    } else {
        return 'child' // 命中中心
    }
}
// #endregion


function onEdgeDoubleClick(e: EdgeMouseEvent) {
    const edgeId = e.edge.id;

    // 简单判断：只允许编辑手动连线 (ID不以 'e-' 开头的通常是手动生成的，
    // 或者你可以检查 store.model.edges 里有没有这个 ID)
    // 如果是思维导图的结构线，可能不希望用户改文字
    const logicEdge = store.model.edges.find(le => le.id === edgeId);

    if (logicEdge) {
        // 这里使用原生 prompt 做最简单的实现
        // 实际项目中可以弹出一个 Modal 或 Popover
        const newLabel = prompt('输入连线文字:', logicEdge.label || '');

        if (newLabel !== null) {
            store.updateEdgeLabel(edgeId, newLabel);
        }
    }
}
</script>

<template>
    <!-- <button class="theme-toggle" @click="toggleDark()">
        {{ isDark ? '🌙' : '☀️' }}
    </button> -->
    <div class="app-container"
        @contextmenu.prevent>
        <VueFlow v-if="true"
            v-model:nodes="store.vueNodes"
            v-model:edges="store.vueEdges"
            :node-types="nodeTypes"
            @dblclick="onDblClick"
            :zoom-on-double-click="false"
            :fit-view-on-init="false"
            @connect="onConnect"
            :delete-key-code="['Delete']"
            :pan-on-drag="[1, 2]"
            :selection-key-code="true"
            multi-selection-key-code="Control"
            :default-edge-options="{
                type: 'default',
                style: { strokeWidth: 2, color: edgeColor },
                interactionWidth: 50,
            }"
            :max-zoom="4"
            :selection-mode="SelectionMode.Partial"
            :edges-updatable="true"
            @edge-update-start="onEdgeUpdateStart"
            @edge-update="onEdgeUpdate"
            @edge-update-end="onEdgeUpdateEnd"

            @node-drag-start="onNodeDragStart"
            @node-drag="onNodeDrag"
            @node-drag-stop="onNodeDragStop"
            @nodes-change="onNodesChange"
            @edges-change="onEdgesChange"
            @edge-double-click="onEdgeDoubleClick"
            :only-render-visible-elements="false"
            :snap-to-grid="true"
            :snap-grid="[gridSize, gridSize]">
            <Background variant="dots" :gap="gridSize" :color="gridColor" :size="2" :offset="[20, 20]" />
            <!-- <Controls /> -->
        </VueFlow>

        <div class="debug-panel">
            <div class="debug-row">
                <span class="label">Nodes:</span>
                <span class="value">{{ store.vueNodes.length - 1 }}</span>
            </div>
            <div class="debug-row">
                <span class="label">Edges:</span>
                <span class="value">{{ store.vueEdges.length }}</span>
            </div>
        </div>
    </div>
</template>

<style>
.app-container {
    /* 使用 100vw/vh 确保占满视口 */
    width: 100vw;
    height: 100vh;

    /* 再次确保没有滚动条 */
    overflow: hidden;
    /* 确保背景色，防止加载时闪白屏 */
}

.debug-panel {
    position: absolute;
    bottom: 10px;
    left: 10px;
    z-index: 10000;
    /* 确保在最上层 */

    background: rgba(0, 0, 0, 0.7);
    /* 半透明黑底 */
    color: #00ff00;
    /* 黑客绿，显眼 */

    padding: 8px 12px;
    border-radius: 6px;
    font-family: 'Consolas', 'Monaco', monospace;
    /* 等宽字体 */
    font-size: 12px;
    line-height: 1.5;

    /* 关键：鼠标穿透 */
    /* 防止挡住画布的左下角操作，让鼠标可以直接穿过去拖拽画布 */
    pointer-events: none;

    /* 防止文本换行 */
    white-space: nowrap;
    backdrop-filter: blur(4px);
    /* 毛玻璃效果 (可选) */
}

.debug-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
}

.label {
    opacity: 0.7;
}

.value {
    font-weight: bold;
}
</style>