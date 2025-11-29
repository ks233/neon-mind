<script setup lang="ts">
import { ref, computed, markRaw, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import type { Connection, NodeTypesObject, Node, Edge, GraphEdge, EdgeMouseEvent, NodeRemoveChange, NodeDragEvent, NodeChange, EdgeChange, GraphNode } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'

// 必须引入 Vue Flow 的默认样式，否则节点会乱飞
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import OriginNode from '@/components/OriginNode.vue'
import MarkdownNode from '@/components/MarkdownNode.vue'
import MindMapNode from '@/components/MindMapNode.vue'

import { useCanvasStore } from '@/stores/canvasStore'

import { useDark, useToggle } from '@vueuse/core'

// #region 初始化

// 自定义节点
const nodeTypes: NodeTypesObject = {
    origin: markRaw(OriginNode as any),
    markdown: markRaw(MarkdownNode as any),
    'mindmap': markRaw(MindMapNode),
}

// 数据单例
const store = useCanvasStore()

// VueFlow 工具函数
const { screenToFlowCoordinate, addEdges, updateEdge } = useVueFlow()

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

    // 修正坐标中心（可选）
    store.addMindMapRoot(x - 75, y - 20)

    // 阻止默认行为（防止选中文字等）
    event.preventDefault()
}

// #endregion

// #region 监听变化

function onConnect(params: Connection) {
    // params 包含了 source(起点ID), target(终点ID), sourceHandle(起点端点ID) 等信息
    // addEdge 是官方提供的工具，它会自动处理去重，并生成 edge 对象
    addEdges(params)
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
    // 这里的逻辑比较简单：直接把当前的 edges 数组全量同步给 model 即可
    // 因为连线数据量通常不大
    nextTick(() => store.updateEdgesModel(store.vueEdges))
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
}

// 4. 拖拽结束时，检查标志位
function onEdgeUpdateEnd(params: EdgeMouseEvent) {
    // 只有在没有触发过 onEdgeUpdate 的情况下，才删除
    const { edge } = params
    if (!isUpdateSuccessful.value) {
        store.vueEdges = store.vueEdges.filter((e) => e.id !== edge.id)
    }

    // 重置状态（可选，为了保险）
    isUpdateSuccessful.value = false
}

// #endregion

// #region 拖拽改变导图层级

const { getIntersectingNodes } = useVueFlow()

// 1. 拖拽中 (Update Loop)
function onNodeDrag(e: NodeDragEvent) {
    // 只处理单选拖拽，且拖拽的是思维导图节点
    const draggedNode = e.node
    if (draggedNode.type !== 'mindmap') return

    // 获取所有与拖拽节点发生碰撞的节点
    // getIntersectingNodes 类似于 Unity Physics.OverlapBox
    const intersections = getIntersectingNodes(draggedNode)

    // 过滤：只关心思维导图节点，且忽略自己和自己的子孙(可选，store里有校验)
    const targetNode = intersections.find(n => n.type === 'mindmap' && n.id !== draggedNode.id)

    if (targetNode) {
        // 更新 Store 的 UI 状态
        store.dragTargetId = targetNode.id
        store.dragIntent = calculateIntent(draggedNode, targetNode)
    } else {
        store.dragTargetId = null
        store.dragIntent = null
    }
}

// 2. 拖拽结束 (OnMouseUp)
function onNodeDragStop(e: NodeDragEvent) {
    const draggedNode = e.node
    e.nodes.forEach((node) => {
        // 同步回 Store
        store.updateNodePosition(node.id, node.position)
    })
    if (store.dragTargetId && store.dragIntent && draggedNode.type === 'mindmap') {
        console.log(`Moving ${draggedNode.id} -> ${store.dragTargetId} (${store.dragIntent})`)

        // 调用 Store 执行逻辑
        store.moveMindMapNodeTo(draggedNode.id, store.dragTargetId, store.dragIntent)
    }



    // 清理状态
    store.dragTargetId = null
    store.dragIntent = null
    store.syncModelToView()
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

</script>

<template>
    <!-- <button class="theme-toggle" @click="toggleDark()">
        {{ isDark ? '🌙' : '☀️' }}
    </button> -->
    <div style="height: 100vh; width: 100vw;">
        <VueFlow
            v-model:nodes="store.vueNodes"
            v-model:edges="store.vueEdges"
            :node-types="nodeTypes"
            @dblclick="onDblClick"
            :zoom-on-double-click="false" fit-view-on-init @connect="onConnect"
            :delete-key-code="['Delete', 'Backspace']" :pan-on-drag="[1, 2]"
            :selection-key-code="true"
            multi-selection-key-code="Control"
            :default-edge-options="{
                type: 'smoothstep',
                style: { strokeWidth: 6, color: edgeColor },
                interactionWidth: 50,
            }"

            :edges-updatable="true"
            @edge-update-start="onEdgeUpdateStart"
            @edge-update="onEdgeUpdate"
            @edge-update-end="onEdgeUpdateEnd"

            @node-drag="onNodeDrag"
            @node-drag-stop="onNodeDragStop"
            @nodes-change="onNodesChange"
            @edges-change="onEdgesChange"
            :snap-to-grid="true"
            :snap-grid="[20, 20]">
            <Background variant="lines" :gap="20" :color="gridColor" :line-width="1" />
            <!-- <Controls /> -->
        </VueFlow>
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
    background: #1a192b;
}
</style>