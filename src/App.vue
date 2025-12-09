<script setup lang="ts">
import { Background } from '@vue-flow/background'
import type { Connection, EdgeChange, EdgeMouseEvent, GraphEdge, GraphNode, NodeDragEvent, NodeTypesObject, Rect, XYPosition } from '@vue-flow/core'
import { SelectionMode, VueFlow, useVueFlow } from '@vue-flow/core'
import { computed, markRaw, ref } from 'vue'

// 必须引入 Vue Flow 的默认样式，否则节点会乱飞
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

import OriginNode from '@/components/OriginNode.vue'
import UniversalNode from '@/components/UniversalNode.vue'
import SelectionToolbar from '@/components/canvas/SelectionToolbar.vue'

import { useCanvasStore } from '@/stores/canvasStore'

import { useDark, useMouse, useToggle } from '@vueuse/core'

import { snapToGrid, snapToGridXY } from '@/utils/grid'
import { useGlobalInteractions } from './composables/useGlobalInteractions'
import { useGlobalShortcuts } from './composables/useGlobalShortcuts'
import { NODE_CONSTANTS } from './config/layoutConfig'
import { useProjectStore } from './stores/projectStore'
import { useUiStore } from './stores/uiStore'
import { LogicNode } from './types/model'
import { useClipboard } from './composables/useClipboard'

// #region 初始化

const { x: rawMouseX, y: rawMouseY } = useMouse()

// 自定义节点
const nodeTypes: NodeTypesObject = {
    origin: markRaw(OriginNode as any),
    markdown: markRaw(UniversalNode),
    'mindmap': markRaw(UniversalNode),
    'Universal': markRaw(UniversalNode),
}

useGlobalInteractions()
useGlobalShortcuts()
useClipboard(); // 启用复制粘贴

// 数据单例
const projectStore = useProjectStore();
const canvasStore = useCanvasStore()
const uiStore = useUiStore()

// VueFlow 工具函数
const { screenToFlowCoordinate, addEdges, updateEdge } = useVueFlow()

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

async function onDblClick(event: MouseEvent) {
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

    const newId = await canvasStore.addMindMapRoot(finalX, finalY)
    uiStore.startEditing(newId)
    uiStore.selectNodeById(newId)
    // 阻止默认行为（防止选中文字等）
    event.preventDefault()
}

// #endregion

// #region 创建和删除边

function onConnect(params: Connection) {
    // params 包含了 source(起点ID), target(终点ID), sourceHandle(起点端点ID) 等信息
    // addEdge 是官方提供的工具，它会自动处理去重，并生成 edge 对象
    addEdges(params)
    canvasStore.createConnection(params)
}

function onEdgesChange(changes: EdgeChange[]) {
    changes.forEach(change => {
        if (change.type === 'remove') {
            canvasStore.removeEdge(change.id)
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
    canvasStore.updateEdgeConnection(edge, connection)
}

// 拖拽到空地时删除边
function onEdgeUpdateEnd(params: EdgeMouseEvent) {
    const { edge } = params
    if (!isUpdateSuccessful.value) {
        canvasStore.removeEdge(edge.id)
    }
    // 重置状态（可选，为了保险）
    isUpdateSuccessful.value = false
}

// #endregion

// #region 拖拽改变导图层级

const { getIntersectingNodes, findNode, selectionKeyCode, d3Selection } = useVueFlow()

const dragStartPos = ref({ x: 0, y: 0 })
const lastDragPos = ref({ x: 0, y: 0 });
const carriedNodes = ref<GraphNode[]>([]); // 缓存被拖拽的视图节点对象，避免每帧去 find
const carriedDragStartPos = ref<Record<string, XYPosition>>({})
function onNodeDragStart(e: NodeDragEvent) {
    const node = e.node;
    dragStartPos.value = { ...node.position }
    // console.log(currentDraggingNode)
    const logicNode = canvasStore.model.nodes[node.id];
    if (logicNode && (logicNode.structure === 'root' || logicNode.structure === 'node')) {

        // 3. 查找所有后代 ID
        const descendantIds = e.nodes.flatMap(node => canvasStore.getDescendantIds(node.id));

        // 4. 设置 UI 状态 (变透明)
        uiStore.carriedNodeIds = new Set(descendantIds);

        // 5. [性能优化] 预先查找并缓存这些视图节点实例
        // 这样在 onNodeDrag 高频触发时，不用每次都去遍历查找
        // e.viewNodes 或者 store.vueNodes 都可以，建议直接用 VueFlow 的内部实例
        carriedNodes.value = uiStore.getGraphNodes(descendantIds)
        carriedNodes.value.forEach(node =>
            carriedDragStartPos.value[node.id] = { x: node.position.x, y: node.position.y }
        )
    }
}

// 1. 拖拽中 (Update Loop)
const PROXY_SIZE = 30;


function onNodeDrag(e: NodeDragEvent) {
    // 只处理单选拖拽，且拖拽的是思维导图节点
    const draggedNode = e.node
    const draggedId = draggedNode.id

    const logicNode = canvasStore.model.nodes[draggedId]

    const mouseEvent = e.event as MouseEvent;
    const { x: mouseX, y: mouseY } = screenToFlowCoordinate({
        x: mouseEvent.clientX,
        y: mouseEvent.clientY
    });
    const proxyRect: Rect = {
        x: mouseX - PROXY_SIZE / 2,
        y: mouseY - PROXY_SIZE / 2,
        width: PROXY_SIZE,
        height: PROXY_SIZE,
    };

    // 获取所有与拖拽节点发生碰撞的节点
    // getIntersectingNodes 类似于 Unity Physics.OverlapBox
    const intersections = getIntersectingNodes(proxyRect, true)

    // 过滤：只关心思维导图节点，且忽略自己和自己的子孙(可选，store里有校验)
    const targetNode = intersections.find(n => n.id !== draggedNode.id && n.id !== 'world-origin')

    if (targetNode) {
        // 更新 Store 的 UI 状态
        uiStore.dragTargetId = targetNode.id
        uiStore.dragIntent = calculateIntentByMouse(mouseY, targetNode)
        uiStore.dragDetachId = null
    } else {
        uiStore.dragTargetId = null
        uiStore.dragIntent = null
    }

    // 断线
    const parentNode = findNode(logicNode.parentId)
    if (parentNode) {
        const dx = draggedNode.position.x - dragStartPos.value.x
        const dy = draggedNode.position.y - dragStartPos.value.y
        // 欧几里得距离
        const distance = Math.sqrt(dx * dx + dy * dy)

        // 3. 判断阈值
        if (distance > DETACH_DISTANCE) {
            uiStore.dragDetachId = draggedId
        } else {
            uiStore.dragDetachId = null
        }
    }
    // 移动显示位置

    if (carriedNodes.value.length > 0) {
        // 1. 计算增量 (Delta)
        const dx = draggedNode.position.x - dragStartPos.value.x;
        const dy = draggedNode.position.y - dragStartPos.value.y;

        // 2. 更新所有子孙节点位置
        // 直接修改 GraphNode 的 position，Vue Flow 会自动高效渲染
        carriedNodes.value.forEach(child => {
            child.position.x = carriedDragStartPos.value[child.id].x + dx
            child.position.y = carriedDragStartPos.value[child.id].y + dy
        });

        // 3. 更新 lastPos 为当前位置，为下一帧做准备
        lastDragPos.value = { ...e.node.position };
    }
    e.nodes.forEach(node => {
        // node.position.x = snapToGrid(node.position.x);
        // node.position.y = snapToGrid(node.position.y);
        node.position.x = node.position.x;
        node.position.y = node.position.y;
    })

}

// 2. 拖拽结束 (OnMouseUp)
function onNodeDragStop(e: NodeDragEvent) {
    const draggedNode = e.node
    const newPositionsRecord: Record<string, XYPosition> = {};
    e.nodes.forEach((node) => {
        node.position.x = snapToGrid(node.position.x);
        node.position.y = snapToGrid(node.position.y);
        // 同步回 Store
        if (uiStore.dragTargetId && uiStore.dragIntent) {
            console.log(`Moving ${draggedNode.id} -> ${uiStore.dragTargetId} (${uiStore.dragIntent})`)
            if (!canvasStore.moveMindMapNodeTo(node.id, uiStore.dragTargetId, uiStore.dragIntent)) {
                newPositionsRecord[node.id] = node.position
            }
        } else if (uiStore.dragDetachId === node.id) {
            canvasStore.detachNode(node.id, node.position)
        } else {
            newPositionsRecord[node.id] = node.position
        }
    })

    if (carriedNodes.value.length > 0) {
        // 1. 将子孙节点的最终位置同步回 Store Model
        // 必须同步，否则下次 syncModelToView 会把它们弹回去
        carriedNodes.value.forEach(child => {
            newPositionsRecord[child.id] = child.position;
        });
        // 2. 清理状态
        uiStore.carriedNodeIds.clear();
        carriedNodes.value = [];
    }

    function mutator(node: LogicNode) {
        node.x = newPositionsRecord[node.id].x
        node.y = newPositionsRecord[node.id].y
    }

    const updateIds = Object.keys(newPositionsRecord)
        .filter(id => canvasStore.isRoot(id))
    if (updateIds.length > 0) {
        canvasStore.updateNodesBatch(updateIds, mutator)
    } else {
        canvasStore.syncModelToView()
    }

    // 清理状态
    uiStore.dragTargetId = null
    uiStore.dragIntent = null
    uiStore.dragDetachId = null
    dragStartPos.value = { x: 0, y: 0 }
    lastDragPos.value = { x: 0, y: 0 }
}

function calculateIntentByMouse(mouseY: number, target: GraphNode): 'child' | 'above' | 'below' {
    // 获取目标节点的几何信息
    // computedPosition 是绝对坐标，必须用这个
    const targetY = target.computedPosition.y;
    const targetHeight = target.dimensions.height || 40;

    // 定义感应区：
    // 上部 25% -> 插入上方
    // 下部 25% -> 插入下方
    // 中间 50% -> 成为子节点
    const zoneHeight = targetHeight * 0.25;

    if (mouseY < targetY + zoneHeight) {
        return 'above';
    } else if (mouseY > targetY + targetHeight - zoneHeight) {
        return 'below';
    } else {
        return 'child';
    }
}
// #endregion


function onEdgeDoubleClick(e: EdgeMouseEvent) {
    const edgeId = e.edge.id;

    // 简单判断：只允许编辑手动连线 (ID不以 'e-' 开头的通常是手动生成的，
    // 或者你可以检查 store.model.edges 里有没有这个 ID)
    // 如果是思维导图的结构线，可能不希望用户改文字
    const logicEdge = canvasStore.model.edges.find(le => le.id === edgeId);

    if (logicEdge) {
        // 这里使用原生 prompt 做最简单的实现
        // 实际项目中可以弹出一个 Modal 或 Popover
        const newLabel = prompt('', logicEdge.label || '');

        if (newLabel !== null) {
            canvasStore.updateEdgeLabel(edgeId, newLabel);
        }
    }
}

function onPaneReadyHandler(instance: any) {
    console.log('VueFlow Pane Ready')
    uiStore.setFlowInstance(instance)
    projectStore.newProject()
}

// 原有的背景点击 (用于退出编辑)
function onPaneClick(event: any) {
    // [!code focus:4] 只有左键点击背景才退出编辑
    // Vue Flow 的 onPaneClick 有时会包含原始事件，做一个防御性检查
    // 如果是中键拖拽产生的 click，这里通常不会触发，但为了保险起见：
    if (uiStore.editingNodeId) {
        uiStore.stopEditing()
    }
}

//#region 双击创建

// === 双击拖拽创建状态机 ===
const DOUBLE_CLICK_DELAY = 300;
const CLICK_DISTANCE_THRESHOLD = 10; // [!code focus] 新增：防抖动距离阈值
const DRAG_THRESHOLD = 5;

let lastClickTime = 0;
let lastClickPos = { x: 0, y: 0 }; // [!code focus] 新增：记录上次点击位置
let potentialDoubleClick = false;
const isCreatingDrag = ref(false);
const creatingStartPos = ref<XYPosition | null>(null);
const creatingNodeId = ref<string | null>(null);

// [!code focus:45] 1. 鼠标按下 (Capture阶段): 处理双击创建、排除节点干扰
function onPanePointerDown(event: PointerEvent) {
    // A. 过滤：只响应左键
    if (event.button !== 0) return;

    // B. [关键修复] 过滤：如果点到了节点、连线、面板，直接忽略
    // 这样就不会拦截 节点拖拽、文本编辑、连线操作 了
    const target = event.target as Element;
    if (target.closest('.vue-flow__node') || target.closest('.vue-flow__edge') || target.closest('.vue-flow__panel')) {
        potentialDoubleClick = false; // 打断双击链
        return;
    }

    const now = Date.now();
    const timeDiff = now - lastClickTime;
    // 计算两次点击的距离
    const dist = Math.hypot(event.clientX - lastClickPos.x, event.clientY - lastClickPos.y);

    // C. 判断双击：时间短 + 距离近
    if (timeDiff < DOUBLE_CLICK_DELAY && dist < CLICK_DISTANCE_THRESHOLD) {
        potentialDoubleClick = true;

        // 记录 Flow 坐标系的起点
        creatingStartPos.value = snapToGridXY(screenToFlowCoordinate({
            x: event.clientX,
            y: event.clientY
        }));

        // [关键修复] 阻止默认行为 -> 防止触发 Vue Flow 的"蓝色框选"
        event.preventDefault();
        event.stopPropagation();
        const el = event.target as Element;
        if (el.setPointerCapture) {
            el.setPointerCapture(event.pointerId);
        }
        // 注意：这里不需要 stopPropagation，因为 preventDefault 已经足够阻止框选
    } else {
        // 第一次点击，记录状态
        lastClickTime = now;
        lastClickPos = { x: event.clientX, y: event.clientY };
        potentialDoubleClick = false;
        isCreatingDrag.value = false;
        creatingNodeId.value = null;
        creatingStartPos.value = null;
    }
}

// 2. 鼠标移动: 处理拖拽大小
function onPanePointerMove(event: PointerEvent) {
    if (!potentialDoubleClick || !creatingStartPos.value) return;

    const currentPos = screenToFlowCoordinate({
        x: event.clientX,
        y: event.clientY
    });

    const dx = currentPos.x - creatingStartPos.value.x;
    const dy = currentPos.y - creatingStartPos.value.y;

    // A. 触发拖拽模式
    if (!isCreatingDrag.value && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        isCreatingDrag.value = true;
        // 创建初始节点
        creatingNodeId.value = canvasStore.addMindMapRoot(creatingStartPos.value.x, creatingStartPos.value.y);
    }

    // B. [关键修复] 实时计算尺寸 (支持四个方向拖拽)
    if (isCreatingDrag.value && creatingNodeId.value) {
        // 1. 宽度/高度取绝对值，并限制最小尺寸
        const rawWidth = snapToGrid(Math.abs(dx));
        const rawHeight = snapToGrid(Math.abs(dy));
        const width = Math.max(rawWidth, NODE_CONSTANTS.MIN_WIDTH);
        const height = Math.max(rawHeight, NODE_CONSTANTS.MIN_HEIGHT);

        // 2. 计算左上角坐标 (x, y)
        // 逻辑：如果往左拖 (dx < 0)，x 应该是 (起点 - 宽度)；否则 x 是起点
        // 这样起点就变成了"锚点"，向左拉会向左延伸，向右拉会向右延伸
        let realX = creatingStartPos.value.x;
        let realY = creatingStartPos.value.y;

        if (dx < 0) realX = creatingStartPos.value.x - width;
        if (dy < 0) realY = creatingStartPos.value.y - height;

        canvasStore.updateNodeSize(creatingNodeId.value, { width, height }, { x: realX, y: realY }, false);
    }
}

// 3. 鼠标松开: 结算
function onPanePointerUp(event: PointerEvent) {
    if (potentialDoubleClick) {
        if (isCreatingDrag.value) {
            console.log('拖拽创建完成');
            if (creatingNodeId.value) {
                // [优化] 拖拽结束时，记录一次历史记录 (updateNodeSize 内部是 false)
                const node = canvasStore.model.nodes[creatingNodeId.value];
                if (node) {
                    canvasStore.updateNodePosition(node.id, { x: node.x, y: node.y }, true);
                    // uiStore.startEditing(node.id);
                }
            }
        } else {
            // 原地双击
            if (creatingStartPos.value) {
                const id = canvasStore.addMindMapRoot(creatingStartPos.value.x, creatingStartPos.value.y);
                uiStore.startEditing(id);
                setTimeout(() => uiStore.selectNodeById(id), 0)
            }
        }
        // Reset
        potentialDoubleClick = false;
        isCreatingDrag.value = false;
        creatingNodeId.value = null;
        creatingStartPos.value = null;
        lastClickTime = 0;

        selectionKeyCode.value = true
    }
}

function onPanePointerLeave() {
    if (isCreatingDrag.value) {
        potentialDoubleClick = false;
        isCreatingDrag.value = false;
        creatingNodeId.value = null;
    }
}
//#endregion


function onAppMouseDown(e: MouseEvent) {
    // 如果是中键 (Button 1)
    if (e.button === 1) {
        // [关键修复] 不要用 .capture，让 Vue Flow 先响应 Pan，然后我们在冒泡阶段拦截默认行为
        // 这样 d3-zoom 已经启动了，但浏览器不会把焦点移到 body，从而保持编辑器聚焦
        e.preventDefault();
    }
}
</script>

<template>
    <!-- <button class="theme-toggle" @click="toggleDark()">
        {{ isDark ? '🌙' : '☀️' }}
    </button> -->
    <div class="app-container"
        @pointerdown.capture="onPanePointerDown"
        @mousedown.capture="onAppMouseDown"
        @pointermove="onPanePointerMove"
        @pointerup="onPanePointerUp"
        @pointerleave="onPanePointerLeave">
        <VueFlow v-if="true"
            @pane-ready="onPaneReadyHandler"
            v-model:nodes="canvasStore.vueNodes"
            v-model:edges="canvasStore.vueEdges"
            :node-types="nodeTypes"
            :zoom-on-double-click="false"
            :fit-view-on-init="true"
            @connect="onConnect"
            :pan-on-drag="[1, 2]"
            multi-selection-key-code="Control"
            :default-edge-options="{
                type: 'smoothstep',
                style: { strokeWidth: 2, color: edgeColor, 'font-size': 20 },
                interactionWidth: 50,
            }"
            :min-zoom="0.25"
            :max-zoom="2"
            :selection-key-code="false"
            :selection-mode="SelectionMode.Partial"
            :edges-updatable="true"
            @edge-update-start="onEdgeUpdateStart"
            @edge-update="onEdgeUpdate"
            @edge-update-end="onEdgeUpdateEnd"
            @pane-click="onPaneClick"
            @node-drag-start="onNodeDragStart"
            @node-drag="onNodeDrag"
            @node-drag-stop="onNodeDragStop"
            @edges-change="onEdgesChange"
            @edge-double-click="onEdgeDoubleClick"
            :only-render-visible-elements="false"
            :snap-to-grid="false"
            :snap-grid="[gridSize, gridSize]">
            <Background variant="dots" :gap="gridSize" :color="gridColor" :size="2" :offset="[20, 20]" />
            <!-- <Controls /> -->
        </VueFlow>
        <SelectionToolbar />

        <div class="debug-panel">
            <div class="debug-row">
                <span class="label">Nodes:</span>
                <span class="value">{{ canvasStore.vueNodes.length - 1 }}</span>
            </div>
            <div class="debug-row">
                <span class="label">Edges:</span>
                <span class="value">{{ canvasStore.vueEdges.length }}</span>
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