import { defineStore } from 'pinia';
import { reactive, ref, toRaw } from 'vue';
import type { CanvasModel, LogicNode, LogicEdge } from '../types/model';
import type { Node, Edge, XYPosition } from '@vue-flow/core';
import { useVueFlow } from '@vue-flow/core';

import { computeMindMapLayout } from '../services/layoutService';

import { createVisualNode } from '../utils/transformers';

export const useCanvasStore = defineStore('canvas', () => {
    // === 1. Model (Source of Truth / Scene Data) ===
    const model = reactive<CanvasModel>({
        rootNodes: [],
        nodes: {},
        edges: [] // 存储非树状结构的额外连线
    });

    // UI 交互状态 (不需要持久化)
    const dragTargetId = ref<string | null>(null);
    const dragIntent = ref<'child' | 'above' | 'below' | null>(null);

    // === 2. View (Render State / GameObjects) ===
    const vueNodes = ref<Node[]>([]);
    const vueEdges = ref<Edge[]>([]);




    async function syncModelToView() {
        const nextNodes: Node[] = [];
        const nextEdges: Edge[] = [];

        // 1. 处理所有游离连线 (LogicEdge -> VueEdge)
        // 这些是用户手动连的线，不是思维导图的层级线
        model.edges.forEach(edge => {
            nextEdges.push({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: 'smoothstep', // 默认线型
                animated: false
            });
        });

        // 2. 遍历根节点，区分处理 "自由节点" 和 "思维导图树"
        for (const rootId of model.rootNodes) {
            const rootNode = model.nodes[rootId];
            if (!rootNode) continue;

            if (rootNode.type === 'free-note') {
                // A. 自由节点：直接转换，不做布局
                nextNodes.push(createVisualNode(rootNode));
            }
            else if (rootNode.type === 'mind-map-root') {
                // B. 思维导图：需要整棵树一起送去计算布局
                // 这是一个异步过程
                const layoutData = await computeMindMapLayout(rootNode, model.nodes);
                nextNodes.push(...layoutData.nodes);
                nextEdges.push(...layoutData.edges);
            }
        }

        // 3. 提交到显存
        vueNodes.value = nextNodes;
        vueEdges.value = nextEdges;
    }


    // 辅助：生成 Vue 节点对象
    function createVisualNode(logic: LogicNode, computedPos?: XYPosition): Node {
        return {
            id: logic.id,
            // 映射组件类型
            type: logic.type === 'free-note' ? 'markdown' : 'mindmap',
            position: computedPos || logic.position || { x: 0, y: 0 },
            data: {
                content: logic.content,
                // 将逻辑类型传给组件，组件可能需要知道自己是不是 root
                isRoot: logic.type === 'mind-map-root'
            },
            // 只有 group 内的节点才需要 parentNode，思维导图我们用 ELK 算坐标，不用 VueFlow 的 parent
            parentNode: undefined,
        };
    }

    // ==========================================================
    // User Actions: View -> Model
    // ==========================================================

    // 1. 添加自由节点
    function addFreeNode(x: number, y: number) {
        const id = crypto.randomUUID();
        const newNode: LogicNode = {
            id,
            type: 'free-note',
            content: 'Free Node',
            position: { x, y },
            childrenIds: []
        };

        model.nodes[id] = newNode;
        model.rootNodes.push(id);

        syncModelToView();
        return id;
    }

    // 2. 添加思维导图子节点
    function addMindMapChild(parentId: string) {
        const parent = model.nodes[parentId];
        if (!parent) return;

        const newId = crypto.randomUUID();
        const newNode: LogicNode = {
            id: newId,
            type: 'mind-map-node', // 子节点类型
            content: `Child ${parent.childrenIds.length + 1}`,
            parentId: parentId,
            childrenIds: []
        };

        // 更新 Model
        model.nodes[newId] = newNode;
        parent.childrenIds.push(newId);

        // 重新计算布局
        syncModelToView();
    }

    // 3. 更新节点位置 (仅针对 Root 或 Free 节点)
    function updateNodePosition(id: string, position: XYPosition) {
        const node = model.nodes[id];
        if (!node) return;

        // 只有自由节点和导图根节点需要存位置
        // 导图子节点的位置是算出来的，拖拽后通常应该弹回去，或者触发复杂的重布局
        if (node.type === 'free-note' || node.type === 'mind-map-root') {
            node.position = position;
        }
    }

    // 4. 更新内容
    function updateNodeContent(id: string, content: string) {
        const node = model.nodes[id];
        if (node) {
            node.content = content;
            // 如果内容变长了，可能影响布局，建议触发一次轻量级重排
            // syncModelToView(); 
        }
    }

    // 5. 递归删除节点
    function removeNodeFromModel(id: string) {
        const node = model.nodes[id];
        if (!node) return;

        // A. 递归删除所有子节点 (针对思维导图)
        if (node.childrenIds && node.childrenIds.length > 0) {
            // 复制一份数组防止遍历时修改
            [...node.childrenIds].forEach(childId => removeNodeFromModel(childId));
        }

        // B. 处理父级引用
        if (node.parentId) {
            const parent = model.nodes[node.parentId];
            if (parent) {
                parent.childrenIds = parent.childrenIds.filter(cid => cid !== id);
            }
        }

        // C. 处理 Root 列表引用
        const rootIndex = model.rootNodes.indexOf(id);
        if (rootIndex !== -1) {
            model.rootNodes.splice(rootIndex, 1);
        }

        // D. 处理游离连线引用
        model.edges = model.edges.filter(e => e.source !== id && e.target !== id);

        // E. 物理删除
        delete model.nodes[id];

        // 触发重绘 (如果是 VueFlow 的事件回调触发的，可能不需要这步，但为了安全起见)
        // 这里的策略是：如果是 Delete 键触发的，视图已经没了，我们只改 Model
        // 如果是代码逻辑触发的，我们需要 sync
    }

    // 6. 更新手动连线 (View -> Model)
    function updateEdgesModel(viewEdges: Edge[]) {
        // 找出所有非生成的线（即 id 不是 e-parent-child 格式的）
        // 或者是我们在 createVisualNode 里标记过的
        const manualEdges = viewEdges.filter(e => !e.id.startsWith('e-'));

        model.edges = manualEdges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target
        }));
    }

    // 7. 新增：添加思维导图根节点 (Entry Point)
    function addMindMapRoot(x: number, y: number) {
        const id = crypto.randomUUID();
        const newNode: LogicNode = {
            id,
            type: 'mind-map-root',
            content: 'Mind Map Root',
            position: { x, y },
            childrenIds: []
        };

        model.nodes[id] = newNode;
        model.rootNodes.push(id);

        syncModelToView();
        return id;
    }



    function addMindMapSibling(currentNodeId: string) {
        const current = model.nodes[currentNodeId];
        if (!current || !current.parentId) return; // 根节点没有同级

        const parent = model.nodes[current.parentId];
        if (!parent) return;

        const newId = crypto.randomUUID();
        const newNode: LogicNode = {
            id: newId,
            type: 'mind-map-node',
            content: '新同级节点',
            parentId: current.parentId,
            childrenIds: []
        };

        // 更新 Model
        model.nodes[newId] = newNode;

        // [关键] 插入到当前节点位置的后面
        const currentIndex = parent.childrenIds.indexOf(currentNodeId);
        if (currentIndex !== -1) {
            // splice(start, deleteCount, item)
            parent.childrenIds.splice(currentIndex + 1, 0, newId);
        } else {
            parent.childrenIds.push(newId);
        }

        syncModelToView();

        // 返回新 ID 以便组件聚焦
        return newId;
    }

    // Action: Alt + 上下箭头 调整顺序
    // offset: -1 (上移), 1 (下移)
    function moveMindMapNode(nodeId: string, offset: number) {
        const current = model.nodes[nodeId];
        if (!current || !current.parentId) return;

        const parent = model.nodes[current.parentId];
        if (!parent) return;

        const index = parent.childrenIds.indexOf(nodeId);
        if (index === -1) return;

        const newIndex = index + offset;

        // 边界检查
        if (newIndex < 0 || newIndex >= parent.childrenIds.length) return;

        // [关键] 交换数组位置
        // 使用解构赋值交换元素
        [parent.childrenIds[index], parent.childrenIds[newIndex]] =
            [parent.childrenIds[newIndex], parent.childrenIds[index]];

        syncModelToView();
    }

    function moveMindMapNodeTo(sourceId: string, targetId: string, type: 'child' | 'above' | 'below') {
        // 1. 基本校验
        if (sourceId === targetId) return; // 不能拖给自己

        const sourceNode = model.nodes[sourceId];
        const targetNode = model.nodes[targetId];
        if (!sourceNode || !targetNode) return;

        // 2. 循环引用检查 (Cycle Detection)
        // 防止把爷爷拖给孙子做儿子，导致死循环
        if (isDescendant(sourceId, targetId)) {
            console.warn("Cannot move a node into its own descendant.");
            return;
        }

        // 3. 确定新的父节点 ID
        let newParentId: string | undefined;
        if (type === 'child') {
            newParentId = targetId;
        } else {
            // 如果是排序，新父级就是目标节点的父级
            newParentId = targetNode.parentId;
        }

        // 根节点保护：如果不允许把节点拖成游离的根节点，这里要拦截
        // 或者支持拖到空地变成根节点(这里暂不实现)
        if (!newParentId) return;

        // 4. === 执行移动 ===

        // A. 从旧父级移除
        if (sourceNode.parentId) {
            const oldParent = model.nodes[sourceNode.parentId];
            if (oldParent) {
                oldParent.childrenIds = oldParent.childrenIds.filter(id => id !== sourceId);
            }
        }

        // B. 设置新父级
        sourceNode.parentId = newParentId;
        const newParent = model.nodes[newParentId];

        // C. 插入到新位置
        if (type === 'child') {
            // 直接追加到末尾
            newParent.childrenIds.push(sourceId);
        } else {
            // 插入到 target 的上方或下方
            const targetIndex = newParent.childrenIds.indexOf(targetId);
            if (targetIndex !== -1) {
                const insertIndex = type === 'above' ? targetIndex : targetIndex + 1;
                newParent.childrenIds.splice(insertIndex, 0, sourceId);
            } else {
                newParent.childrenIds.push(sourceId); // 防御性
            }
        }

        // 5. 触发重排
        syncModelToView();
    }

    // 辅助：检查 checkId 是否是 rootId 的后代
    function isDescendant(rootId: string, checkId: string): boolean {
        const root = model.nodes[rootId];
        if (!root || !root.childrenIds) return false;

        for (const childId of root.childrenIds) {
            if (childId === checkId) return true;
            if (isDescendant(childId, checkId)) return true;
        }
        return false;
    }


    function updateNodeSize(id: string, size: { width: number, height: number }) {
        const node = model.nodes[id];
        if (node) {
            node.width = size.width;
            node.height = size.height;

            // [关键] 尺寸变了，思维导图的布局必须重算，否则会重叠
            if (node.type === 'mind-map-node' || node.type === 'mind-map-root') {
                // 使用防抖 (Debounce) 或直接调用，取决于性能要求
                syncModelToView();
            }
        }
    }

    return {
        // State
        model,
        vueNodes,
        vueEdges,
        // Actions
        addFreeNode,
        addMindMapRoot,
        addMindMapChild,
        updateNodePosition,
        updateNodeContent,
        removeNodeFromModel,
        updateEdgesModel,
        syncModelToView,
        addMindMapSibling,
        moveMindMapNode,
        moveMindMapNodeTo,
        updateNodeSize,
        dragTargetId,
        dragIntent
    };
});