import { defineStore } from 'pinia';
import { reactive, ref, toRaw } from 'vue';
import type { CanvasModel, LogicNode, LogicEdge } from '../types/model';
import type { Node, Edge, XYPosition } from '@vue-flow/core';
import { useVueFlow } from '@vue-flow/core';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

export const useCanvasStore = defineStore('canvas', () => {
    // === 1. Model (Source of Truth / Scene Data) ===
    const model = reactive<CanvasModel>({
        rootNodes: [],
        nodes: {},
        edges: [] // 存储非树状结构的额外连线
    });

    // UI 交互状态 (不需要持久化)
    const highlightTargetId = ref<string | null>(null);
    const highlightIntent = ref<'child' | 'above' | 'below' | null>(null);

    // === 2. View (Render State / GameObjects) ===
    const vueNodes = ref<Node[]>([]);
    const vueEdges = ref<Edge[]>([]);

    // 获取引擎实例
    const { fitView } = useVueFlow();

    // ==========================================================
    // Core Pipeline: Model -> View (Deserialization & Layout)
    // ==========================================================

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
                const layoutData = await computeMindMapLayout(rootNode);
                nextNodes.push(...layoutData.nodes);
                nextEdges.push(...layoutData.edges);
            }
        }

        // 3. 提交到显存
        vueNodes.value = nextNodes;
        vueEdges.value = nextEdges;
    }

    // ==========================================================
    // Layout Engine: Mind Map Calculation
    // ==========================================================

    async function computeMindMapLayout(rootNode: LogicNode) {
        // 1. 准备 ELK 需要的容器 (Graph Container)
        // 我们把整棵思维导图看作一个巨大的 Group，里面的节点都是平级的
        const elkNodes: ElkNode[] = [];
        const elkEdges: any[] = [];

        // 2. 广度优先/递归遍历逻辑树，把它拍平 (Flatten)
        // 我们需要一个队列来遍历 LogicNode 树
        const queue = [rootNode];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const curr = queue.shift()!;
            if (visited.has(curr.id)) continue;
            visited.add(curr.id);

            // A. 添加节点到 ELK 平铺列表
            elkNodes.push({
                id: curr.id,
                // 根据内容估算宽度，这里简略写死，理想情况应该根据 text length 动态算
                width: Math.max(100, curr.content.length * 10 + 20),
                height: 40,
            });

            // B. 处理子节点
            if (curr.childrenIds && curr.childrenIds.length > 0) {
                curr.childrenIds.forEach(childId => {
                    const childNode = model.nodes[childId];
                    if (childNode) {
                        // 添加到队列
                        queue.push(childNode);

                        // C. 添加连线关系 (Edge)
                        // 这才是告诉 ELK "谁是谁父亲" 的关键，而不是用 children 嵌套
                        elkEdges.push({
                            id: `e-${curr.id}-${childNode.id}`,
                            sources: [curr.id],
                            targets: [childNode.id]
                        });
                    }
                });
            }
        }

        // 3. 构建 ELK Root Graph
        const elkGraph: ElkNode = {
            id: 'root-graph',
            layoutOptions: {
                'elk.algorithm': 'layered',
                'elk.direction': 'RIGHT',
                'elk.spacing.nodeNode': '30',
                'elk.layered.spacing.nodeNodeBetweenLayers': '100',

                // [!code focus:4] === 核心修正：强制固定顺序 ===
                // 告诉 ELK：请严格尊重我传入的数据顺序，不要自己瞎优化
                'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
                'elk.layered.crossingMinimization.strategy': 'NONE', // 关闭交叉最小化，进一步防止乱序
            },
            children: elkNodes,
            edges: elkEdges
        };

        // 4. 运行算法
        const layoutedGraph = await elk.layout(elkGraph);

        // 5. 将计算结果回填给 VueNodes
        const resultNodes: Node[] = [];
        const resultEdges: Edge[] = [];

        // 获取根节点在 ELK 里的计算位置，用于计算相对偏移
        // 我们希望 Root 节点依然保持在它原来的 World Position
        // 所以我们需要计算一个 "Delta"，把整棵树移过去
        const elkRootNode = layoutedGraph.children?.find(n => n.id === rootNode.id);

        // 偏移量 = (用户设定的 Root 世界坐标) - (ELK 算出来的 Root 相对坐标)
        const offsetX = (rootNode.position?.x || 0) - (elkRootNode?.x || 0);
        const offsetY = (rootNode.position?.y || 0) - (elkRootNode?.y || 0);

        if (layoutedGraph.children) {
            layoutedGraph.children.forEach(elkNode => {
                const logicNode = model.nodes[elkNode.id];
                if (!logicNode) return;

                // 应用偏移量，让树跟随后台的 Root Position
                const finalX = (elkNode.x || 0) + offsetX;
                const finalY = (elkNode.y || 0) + offsetY;

                // 生成 Vue Node
                resultNodes.push(createVisualNode(logicNode, { x: finalX, y: finalY }));
            });
        }

        if (layoutedGraph.edges) {
            layoutedGraph.edges.forEach(elkEdge => {
                // 生成 Vue Edge
                // 这里要小心，elkEdge.sources[0] 是节点 ID
                // 但我们需要去原始数据里找 source 和 target
                // 简单点直接用我们生成的 id 解析，或者直接从 elkEdge 对象读
                // ELK edge 结构比较复杂，为了保险，我们直接重新生成一遍简单的连线
                // 或者在这里解析: source = elkEdge.sources[0], target = elkEdge.targets[0]

                // 更简单的做法：直接利用 Logic 数据生成连线，因为连线不需要坐标
                // 只要节点坐标对了，Vue Flow 会自动画线
                // 但如果想用 ELK 的路由点(sections)，则需要解析 sections
                // 现阶段 MVP：让 Vue Flow 自己画线 (type: smoothstep)
                // 只需要确保 edges 列表存在即可
            });
        }

        // 重新遍历一遍 model 生成连线 (比解析 ELK edge 简单)
        // 仅生成树内部的连线
        queue.length = 0;
        queue.push(rootNode);
        visited.clear();

        while (queue.length > 0) {
            const curr = queue.shift()!;
            if (visited.has(curr.id)) continue;
            visited.add(curr.id);

            if (curr.childrenIds) {
                curr.childrenIds.forEach(childId => {
                    const childNode = model.nodes[childId];
                    if (childNode) {
                        queue.push(childNode);
                        resultEdges.push({
                            id: `e-${curr.id}-${childId}`,
                            source: curr.id,
                            target: childId,
                            type: 'smoothstep', // 直角连线
                            animated: false,
                            selectable: false,
                        });
                    }
                });
            }
        }

        return { nodes: resultNodes, edges: resultEdges };
    }

    // 辅助：构建 ELK 树
    function buildElkGraph(node: LogicNode): ElkNode {
        const children = node.childrenIds
            .map(id => model.nodes[id])
            .filter(n => !!n)
            .map(child => buildElkGraph(child));

        return {
            id: node.id,
            width: 150, // 估算宽度，最好根据内容动态计算
            height: 50, // 估算高度
            children: children,
            // 告诉 ELK 端口位置，优化连线
            layoutOptions: {
                'elk.portConstraints': 'FIXED_SIDE'
            }
        };
    }

    // 辅助：拍平 ELK 树 -> Vue Objects
    function flattenElkGraph(
        elkNode: ElkNode,
        offset: XYPosition,
        outNodes: Node[],
        outEdges: Edge[]
    ) {
        const logicNode = model.nodes[elkNode.id];

        // 计算绝对坐标 = 偏移量(通常是根节点位置) + ELK计算的相对位置
        const currentPos = {
            x: offset.x + (elkNode.x || 0),
            y: offset.y + (elkNode.y || 0)
        };

        // 生成节点
        outNodes.push(createVisualNode(logicNode, currentPos));

        // 处理子节点
        if (elkNode.children && elkNode.children.length > 0) {
            elkNode.children.forEach(childElk => {
                // 生成连线 (Implicit Tree Edge)
                outEdges.push({
                    id: `e-${elkNode.id}-${childElk.id}`,
                    source: elkNode.id,
                    target: childElk.id,
                    type: 'smoothstep',
                    animated: true, // 导图连线默认带动画区分
                });

                // 递归处理子节点，注意：ELK 子节点坐标是相对于父节点的
                // 如果使用 ELK 的 hierarchy 处理，通常需要小心坐标系
                // 这里假设 simple layout，坐标累加逻辑需根据 ELK 配置调整
                // 简单起见，这里假设我们只用 Root 的 offset，内部用 ELK 相对父级的偏移
                // *修正*：对于 'layered' 算法，通常返回的是相对于包含它的容器的坐标
                // 在这里我们做平铺，直接用 Root Offset 即可
                flattenElkGraph(childElk, offset, outNodes, outEdges);
            });
        }
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
        highlightTargetId, 
        highlightIntent
    };
});