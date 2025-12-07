import { NodeGeometry } from "@/services/layoutService";
import { GraphNode, VueFlowStore } from "@vue-flow/core";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";

// stores/uiStore.ts
export const useUiStore = defineStore('ui', () => {
    //#region useVueFlow() 依赖注入
    const flowInstance = shallowRef<VueFlowStore | null>(null);

    function setFlowInstance(instance: VueFlowStore) {
        flowInstance.value = instance;
    }
    //#endregion

    const carriedNodeIds = ref<Set<string>>(new Set());

    const selectionCount = computed(() =>
        flowInstance.value?.getSelectedNodes.value.length ?? 0
    )

    // 编辑状态
    const editingNodeId = ref<string | null>(null);

    // 拖拽交互状态
    const dragTargetId = ref<string | null>(null);
    const dragIntent = ref<'child' | 'above' | 'below' | null>(null);
    const dragDetachId = ref<string | null>(null);

    const selectedNodes = computed(getSelectedNodes)

    function getSelectedNodes() {
        const instance = flowInstance.value;
        if (!instance) return []; // 防御性检查
        return instance.getSelectedNodes.value
    }

    function getSelectedNodeIds() {
        const instance = flowInstance.value;
        if (!instance) return []; // 防御性检查
        return instance.getSelectedNodes.value.map(n => n.id)
    }

    function selectNodeById(id: string) {
        const instance = flowInstance.value;
        if (!instance) return; // 防御性检查
        const node = instance.findNode(id);
        if (node) {
            instance.addSelectedNodes([node]);
        }
    }

    function getAllNodeIds() {
        const instance = flowInstance.value;
        if (!instance) return []; // 防御性检查
        return instance.getNodes.value.map(n => n.id).filter(n => n !== 'world-origin')
    }

    function clearSelection() {
        const instance = flowInstance.value;
        if (!instance) return; // 防御性检查

        // 去除当前选中
        instance.removeSelectedNodes(instance.getSelectedNodes.value);

    }

    // Action: 命令指定节点进入编辑
    function startEditing(id: string) {
        editingNodeId.value = id;
    }

    // Action: 退出编辑（或清理状态）
    function stopEditing() {
        editingNodeId.value = null;
    }

    function getGraphNode(id: string) {
        const instance = flowInstance.value;
        if (!instance) return; // 防御性检查
        return instance.findNode(id)
    }

    function getGraphNodes(ids: string[]) {
        const instance = flowInstance.value;
        if (!instance) return []; // 防御性检查
        const newGraphNodes = ids
            .map(id => instance.findNode(id))
            .filter((n): n is GraphNode => typeof n !== 'undefined'); // 过滤掉潜在的 undefined
        return newGraphNodes
    }

    function getAllGraphNodes() {
        const instance = flowInstance.value;
        if (!instance) return []; // 防御性检查
        return instance.getNodes.value
    }
    // 选中状态 (如果不想用 VueFlow 的 hook，也可以存这里)

    function selectNodes(nodes: GraphNode[]) {
        const instance = flowInstance.value;
        if (!instance) return []; // 防御性检查
        instance.addSelectedNodes(nodes)
    }

    function startEditSelectedNode() {
        const instance = flowInstance.value;
        if (!instance) return []; // 防御性检查
        const selectedNodes = instance.getSelectedNodes.value;
        if (selectedNodes.length == 1) {
            const selectedNode = selectedNodes[0]
            startEditing(selectedNode.id)
        }
    }

    function getGeometryMap(modelNodes: Record<string, any>): Map<string, NodeGeometry> {
        const instance = flowInstance.value;
        const map = new Map<string, NodeGeometry>();
        if (!instance) return map;

        const graphNodes = instance.getNodes.value;

        graphNodes.forEach(gn => {
            const logicNode = modelNodes[gn.id];
            // 必须确保逻辑节点存在，否则无法获取 childrenIds 结构信息
            if (logicNode) {
                map.set(gn.id, {
                    id: gn.id,
                    // 优先使用计算后的绝对坐标
                    x: gn.computedPosition.x,
                    y: gn.computedPosition.y,
                    // 优先使用真实渲染尺寸
                    width: gn.dimensions.width || logicNode.width || 0,
                    height: gn.dimensions.height || logicNode.height || 0,
                    // 结构关系依然信赖 Model
                    childrenIds: logicNode.childrenIds || []
                });
            }
        });

        return map;
    }

    return {
        setFlowInstance,
        selectedNodes,
        getSelectedNodeIds,
        getAllNodeIds,
        // 获取 GraphNode
        getGraphNode,
        getGraphNodes,
        getAllGraphNodes,
        getSelectedNodes,
        // 拖拽状态
        carriedNodeIds,
        dragTargetId,
        dragIntent,
        dragDetachId,
        // 选中
        selectionCount,
        selectNodeById,
        clearSelection,
        // editing
        editingNodeId,
        startEditing,
        stopEditing,
        selectNodes,
        startEditSelectedNode,
        getGeometryMap
    };
});