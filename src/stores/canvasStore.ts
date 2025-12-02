import { defineStore } from 'pinia';
import { nextTick, reactive, ref, shallowRef, toRaw } from 'vue';
import type { CanvasModel, LogicNode, LogicEdge, MarkdownPayload, ImagePayload, LinkPayload } from '../types/model';
import type { Node, Edge, XYPosition, Connection, GraphNode } from '@vue-flow/core';
import { MarkerType, useVueFlow } from '@vue-flow/core';

import { computeMindMapLayout } from '@/services/layoutService';

import { useDebounceFn } from '@vueuse/core';
import { NODE_CONSTANTS } from '@/config/layoutConfig';
import { fetchLinkMetadata } from '@/services/linkService';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ProjectService } from '@/services/projectService';

import { produce, applyPatches, enableMapSet, type Patch, enablePatches } from 'immer';

// 开启 Set/Map 支持 (你的 model 用到了 Set)
enableMapSet();
enablePatches();

interface HistoryEntry {
    undo: Patch[]; // 反向补丁 (用于撤销)
    redo: Patch[]; // 正向补丁 (用于重做)
}

export const useCanvasStore = defineStore('canvas', () => {
    // #region 全局数据
    const model = shallowRef<CanvasModel>({
        rootNodes: new Set(),
        nodes: {},
        edges: [] // 存储非树状结构的额外连线
    });

    // #region 撤消重做
    // [!code focus] 历史栈改存 Patch 数组，而不是巨大的 JSON 字符串
    const historyStack = shallowRef<HistoryEntry[]>([]);
    const futureStack = shallowRef<HistoryEntry[]>([]);

    function execute(mutator: (draft: CanvasModel) => void, recordHistory = true) {
        if (recordHistory) {
            console.trace("execute")
        }
        const nextState = produce(model.value, mutator,
            (patches, inversePatches) => {
                if (recordHistory) {
                    // 记录补丁
                    historyStack.value.push({
                        undo: inversePatches,
                        redo: patches
                    });

                    if (historyStack.value.length > 50) historyStack.value.shift();
                    futureStack.value = [];
                }
            });

        // [关键] 更新状态：直接替换 .value
        // Vue 会检测到 value 变了，触发响应式更新
        // 由于 Immer 的结构共享，没变的部分引用一致，Vue 不会过度渲染
        model.value = nextState;

        // 触发视图同步 (位置、结构变化时)
        syncModelToView();
    }

    // === 撤销 ===
    function undo() {
        const entry = historyStack.value.pop();
        if (!entry) return;
        // 应用反向补丁 (变回旧状态)
        model.value = applyPatches(model.value, entry.undo);

        futureStack.value.push(entry);
        syncModelToView(); // 确保视图同步
    }

    // === 重做 ===
    function redo() {
        const entry = futureStack.value.pop();
        if (!entry) return;

        // 应用正向补丁 (变回新状态)
        model.value = applyPatches(model.value, entry.redo);

        historyStack.value.push(entry);
        syncModelToView();
    }
    // #endregion

    // UI 交互状态 (不需要持久化)
    const dragTargetId = ref<string | null>(null);
    const dragIntent = ref<'child' | 'above' | 'below' | null>(null);
    const dragDetachId = ref<string | null>(null);

    // 坐标轴 UI 节点
    const worldOriginNode: Node = {
        id: 'world-origin',
        type: 'origin', // 对应上面的 key
        position: { x: 0, y: 0 },
        data: {},
        draggable: false, // 禁止拖拽
        selectable: false, // 禁止选中
        zIndex: -1,
    };

    // 实际显示的节点和边
    const vueNodes = shallowRef<Node[]>([worldOriginNode]);
    const vueEdges = shallowRef<Edge[]>([]);

    // #endregion


    // #region 【数据 -> UI】刷新

    async function syncModelToView() {
        const nextNodes: Node[] = [worldOriginNode];
        const nextEdges: Edge[] = [];

        // 1. 处理所有游离连线 (LogicEdge -> VueEdge)
        // 这些是用户手动连的线，不是思维导图的层级线
        model.value.edges.forEach(edge => {
            nextEdges.push({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: 'default', // 默认线型
                animated: false,

                // [!code focus:5] 恢复 Handle 和 Label
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
                label: edge.label, // Vue Flow 会自动渲染这个 label

                style: { stroke: '#b1b1b7', strokeWidth: 2 },
                // 增加 label 样式 (可选)
                labelStyle: { fill: '#888', fontWeight: 600, fontSize: 12 },
                labelBgStyle: { fill: 'var(--bg-color)', fillOpacity: 0.8 },

                // [!code focus:2] 样式：添加箭头
                markerEnd: MarkerType.ArrowClosed, // 闭合箭头

            });
        });

        // 2. 遍历根节点，区分处理 "自由节点" 和 "思维导图树"

        for (const rootId of model.value.rootNodes) {
            const rootNode = model.value.nodes[rootId];
            if (!rootNode) continue;
            const layoutData = await computeMindMapLayout(rootNode, model.value.nodes);
            nextNodes.push(...layoutData.nodes);
            nextEdges.push(...layoutData.edges);
        }

        // 3. 提交到显存
        vueNodes.value = nextNodes;
        vueEdges.value = nextEdges;

    }
    //#endregion

    // #region 【UI -> 数据】增

    function createConnection(params: Connection) {
        execute(draft => {
            const id = `e-${params.source}-${params.sourceHandle}-${params.target}-${params.targetHandle}`;

            // 检查是否已存在 (防止重复连线)
            if (draft.edges.find(e => e.id === id)) return;

            draft.edges.push({
                id,
                source: params.source,
                target: params.target,

                // [!code focus:2] 保存具体的连接桩点
                sourceHandle: params.sourceHandle ?? undefined,
                targetHandle: params.targetHandle ?? undefined,

                label: '' // 默认无文字
            });
        })
    }

    // [新增] 创建内容节点的通用方法 (图片/链接)
    // 如果传入 parentId，则创建为子节点；否则创建为游离节点
    async function addContentNode(
        type: 'image' | 'link',
        data: string | File,
        position: { x: number, y: number },
        parentId?: string
    ) {
        const id = crypto.randomUUID();
        const baseNode = {
            id,
            structure: parentId ? 'node' : 'root', // 有父级就是 node，没有就是 root (游离)
            parentId: parentId,
            childrenIds: [],
            x: position.x,
            y: position.y,
            fixedSize: false,
        };
        await execute(draft => {
            let payload: any;

            // 1. 构造图片节点数据
            if (type === 'image') {
                let displaySrc = ''
                if (data instanceof File) {
                    displaySrc = URL.createObjectURL(data); // MVP: 使用 Blob URL
                } else {
                    displaySrc = convertFileSrc(data);
                }

                payload = {
                    ...baseNode,
                    contentType: 'image',
                    // height 会由 Layout 根据 ratio 算出来
                    ratio: 1, // 初始比例，组件加载完会更新
                    width: 200, // 默认宽
                    localSrc: undefined, // 标记为"未持久化"
                    displaySrc: displaySrc, // 立即显示
                } as ImagePayload;
            }
            // 2. 构造链接节点数据
            else if (type === 'link' && typeof data === 'string') {
                payload = {
                    ...baseNode,
                    contentType: 'link',
                    url: data,
                    metaTitle: 'Loading...',
                    width: 300,
                    height: 100
                } as LinkPayload;

                // 异步获取元数据
                fetchLinkMetadata(data).then(meta => {
                    updateNodeData(id, {
                        metaTitle: meta.title,
                        metaDescription: meta.description,
                        metaImage: meta.image
                    });
                });
            }

            if (payload) {
                draft.nodes[id] = payload;

                if (parentId) {
                    // 如果是作为子节点插入
                    const parent = draft.nodes[parentId];
                    if (parent) parent.childrenIds.push(id);
                } else {
                    // 如果是作为游离节点
                    draft.rootNodes.add(id);
                }
            }
        })
    }


    // 添加思维导图根节点
    async function addMindMapRoot(x: number, y: number) {
        const id = crypto.randomUUID();
        await execute(draft => {
            const newNode: MarkdownPayload = {
                id,
                structure: 'root',
                contentType: 'markdown',
                content: 'Mind Map Root',
                x,
                y,
                width: NODE_CONSTANTS.MIN_WIDTH,
                height: NODE_CONSTANTS.MIN_HEIGHT,
                childrenIds: []
            };

            draft.nodes[id] = newNode;
            draft.rootNodes.add(id);
        })
        return id;
    }

    async function addMindMapChildBatch(parentIds: string[]): Promise<string[]> {
        const newIds: string[] = [];
        await execute(draft => {
            if (parentIds.length === 0) return [];

            // 1. 批量更新数据模型 (纯 JS 操作，极快)
            parentIds.forEach(parentId => {
                const parent = draft.nodes[parentId];
                if (!parent) return;

                const newId = crypto.randomUUID();
                const newNode: MarkdownPayload = {
                    id: newId,
                    structure: 'node',
                    contentType: 'markdown',
                    content: '子主题',
                    x: 0, y: 0,
                    width: NODE_CONSTANTS.MIN_WIDTH,
                    height: NODE_CONSTANTS.MIN_HEIGHT,
                    fixedSize: false,
                    parentId: parentId,
                    childrenIds: []
                };

                draft.nodes[newId] = newNode;
                parent.childrenIds.push(newId);
                newIds.push(newId);
            });
        })
        return newIds
        // addSelectedNodes(nodesToSelect.map(id => findNode(id) as GraphNode))
    }

    async function addMindMapSiblingBatch(currentNodeIds: string[]) {

        const newIds: string[] = [];

        const anyHasParent = currentNodeIds.some(id => model.value.nodes[id]?.parentId)
        if (!anyHasParent) {
            return newIds
        }

        await execute(draft => {
            currentNodeIds.forEach(currentNodeId => {
                const current = draft.nodes[currentNodeId];
                if (!current || !current.parentId) return; // 根节点没有同级

                const parent = draft.nodes[current.parentId];
                if (!parent) return;

                const newId = crypto.randomUUID();
                const newNode: LogicNode = {
                    id: newId,
                    structure: 'node',
                    contentType: 'markdown', // 子节点类型
                    content: `Child ${parent.childrenIds.length + 1}`,
                    parentId: parent.id,
                    x: 0,
                    y: 0,
                    fixedSize: false,
                    width: NODE_CONSTANTS.MIN_WIDTH,
                    height: NODE_CONSTANTS.MIN_HEIGHT,
                    childrenIds: []
                };

                // 更新 Model
                draft.nodes[newId] = newNode;

                // [关键] 插入到当前节点位置的后面
                const currentIndex = parent.childrenIds.indexOf(currentNodeId);
                if (currentIndex !== -1) {
                    // splice(start, deleteCount, item)
                    parent.childrenIds.splice(currentIndex + 1, 0, newId);
                } else {
                    parent.childrenIds.push(newId);
                }
                newIds.push(newId)
            })

        })

        // 返回新 ID 以便组件聚焦
        return newIds;
    }
    //#endregion

    // #region 【UI -> 数据】删

    // 5. 递归删除节点
    async function removeNodeFromModel(id: string) {
        await execute(draft => {
            const node = draft.nodes[id];
            if (!node) return;

            // A. 递归删除所有子节点 (针对思维导图)
            if (node.childrenIds && node.childrenIds.length > 0) {
                // 复制一份数组防止遍历时修改
                [...node.childrenIds].forEach(childId => removeNodeFromModel(childId));
            }

            // B. 处理父级引用
            if (node.parentId) {
                const parent = draft.nodes[node.parentId];
                if (parent) {
                    parent.childrenIds = parent.childrenIds.filter(cid => cid !== id);
                }
            }

            // C. 处理 Root 列表引用
            draft.rootNodes.delete(id);

            // D. 处理游离连线引用
            draft.edges = draft.edges.filter(e => e.source !== id && e.target !== id);

            // E. 物理删除
            delete draft.nodes[id];
        })
    }

    //#endregion

    // #region 【UI -> 数据】改

    // 更新节点位置 (仅针对 Root 或 Free 节点)
    function updateNodePosition(id: string, position: XYPosition, recordHistory = true) {
        execute(draft => {
            const node = draft.nodes[id];
            if (!node) return;
            node.x = position.x;
            node.y = position.y
        }, recordHistory)
    }

    function updateNodeSize(id: string, size: { width: number, height: number }) {
        execute(draft => {
            const node = draft.nodes[id];
            if (node) {
                node.width = size.width;
                node.height = size.height;
                node.fixedSize = true;
                // 使用防抖 (Debounce) 或直接调用，取决于性能要求
                debouncedLayout();
            }
        })
    }

    // 更新内容
    function updateNodeContent(id: string, content: string) {
        execute(draft => {
            const node = draft.nodes[id] as MarkdownPayload;
            if (node) {
                node.content = content;
            }
        })
    }

    async function updateNodeLink(id: string, url: string) {
        execute(draft => {
            const node = draft.nodes[id];
            if (node && node.contentType === 'link') {
                node.url = url;

                // 模拟：获取元数据 (实际开发中调用 Tauri Rust Command)
                // 这里的逻辑通常是: 前端 -> Rust/Node -> fetch(url) -> 解析HTML -> 返回 title/image
                node.metaTitle = 'Loading...';

                setTimeout(() => {
                    node.metaTitle = 'Example Website Title';
                    node.metaDescription = 'This is a simulated description fetched from the URL.';
                    // node.metaImage = '...';
                }, 1000);
            }
        })
    }

    // 用于更新节点的任意属性 (Partial<LogicNode>)
    function updateNodeData(id: string, data: Partial<LogicNode>) {
        execute(draft => {
            const node = draft.nodes[id];
            if (!node) return;

            // 1. 合并数据到 Model
            // Object.assign 可以将 data 中的字段覆盖到 node 上
            Object.assign(node, data);

            // 2. 判断是否需要触发重排
            // 如果更新了 'ratio' (宽高比)，这会改变自动模式下图片的高度
            // 因此必须触发布局计算，否则会导致图片与其他节点重叠
            if ('ratio' in data) {
                // 使用防抖布局，防止频繁触发
                debouncedLayout();
            }
        })
    }

    // 仅当 fixedSize = false 时调用
    function reportAutoContentSize(id: string, size: { width: number, height: number }) {
        // 1. 先进行只读检查 (读取 Frozen 对象是没问题的，不会报错)
        // 这里的 model.value.nodes[id] 是只读的，只能读，不能改
        const currentNode = model.value.nodes[id];

        if (currentNode && !currentNode.fixedSize) {
            // 检查数值是否变化 (读取操作)
            if (currentNode.width !== size.width || currentNode.height !== size.height) {

                // 2. [核心修复] 使用 execute 修改
                // 所有的写入操作必须通过 execute(draft => ...) 进行
                execute((draft) => {
                    const node = draft.nodes[id]; // 获取 draft 代理对象
                    if (node) {
                        node.width = size.width;
                        node.height = size.height;
                    }
                }, false);
            }
        }
    }

    // 防抖的布局函数，避免打字时每帧都重排
    const debouncedLayout = useDebounceFn(() => {
        syncModelToView();
    }, 300);

    function updateEdgeLabel(id: string, label: string) {
        execute(draft => {
            const edge = draft.edges.find(e => e.id === id);
            if (edge) {
                edge.label = label;
            }
        })
    }
    //#endregion

    // #region 【UI -> 数据】移
    // Action: Alt + 上下箭头 调整顺序
    // offset: -1 (上移), 1 (下移)
    function moveMindMapNode(nodeId: string, offset: number) {
        execute(draft => {
            const current = draft.nodes[nodeId];
            if (!current || !current.parentId) return;

            const parent = draft.nodes[current.parentId];
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
        })
    }

    function moveMindMapNodeTo(sourceId: string, targetId: string, type: 'child' | 'above' | 'below') {
        execute(draft => {
            // 1. 基本校验
            if (sourceId === targetId) return; // 不能拖给自己

            const sourceNode = draft.nodes[sourceId];
            const targetNode = draft.nodes[targetId];
            if (!sourceNode || !targetNode) return;

            // 2. 循环引用检查 (Cycle Detection)
            // 防止把爷爷拖给孙子做儿子，导致死循环
            if (isDescendant(draft, sourceId, targetId)) {
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

            if (newParentId) {
                const node = draft.nodes[sourceId];
                const oldParentId = node.parentId
                if (oldParentId) {
                    const oldParent = draft.nodes[oldParentId]
                    const index = oldParent.childrenIds.indexOf(sourceId);
                    if (index !== -1) {
                        oldParent.childrenIds.splice(index, 1);
                    }
                }
                node.parentId = newParentId
                node.structure = 'node'
                draft.rootNodes.delete(sourceId);
            }

            // B. 设置新父级
            sourceNode.parentId = newParentId;

            const newParent = draft.nodes[newParentId];

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
        })
    }
    // #endregion

    // #region 【UI -> 数据】刷新
    function updateEdgesModel(viewEdges: Edge[]) {
        // 找出所有非生成的线（即 id 不是 e-parent-child 格式的）
        // 或者是我们在 createVisualNode 里标记过的
        execute(draft => {
            const manualEdges = viewEdges.filter(e => !e.id.startsWith('e-'));

            draft.edges = manualEdges.map(e => ({
                id: e.id,
                source: e.source,
                target: e.target,

                sourceHandle: e.sourceHandle ?? undefined,
                targetHandle: e.targetHandle ?? undefined,
                label: e.label
            } as LogicEdge));
        }, false)
    }

    // Store Action
    function detachNode(id: string, position: XYPosition) {
        execute(draft => {
            const node = draft.nodes[id];
            if (!node) return; // 1. 防御性检查：节点是否存在

            // 如果已经是根节点，直接跳过（避免重复添加）
            if (draft.rootNodes.has(id)) return;

            // 2. 处理旧父级关系
            if (node.parentId) {
                const parent = draft.nodes[node.parentId];
                if (parent) {
                    // 推荐写法：找到索引并删除
                    const index = parent.childrenIds.indexOf(id);
                    if (index !== -1) {
                        parent.childrenIds.splice(index, 1);
                    }
                }
            }

            // 3. 更新节点自身状态
            // 如果你用了之前的结构重构，记得把 contentType 保持不变，只改 structure
            node.structure = 'root';
            node.parentId = undefined;

            // 4. 更新根节点索引
            draft.rootNodes.add(id);

            // 5. 更新位置
            node.x = position.x;
            node.y = position.y
        })
    }

    //#endregion

    //#region 数据持久化
    async function saveToFile() {
        await ProjectService.saveProject(model.value);
    }

    async function loadModel(loadedModel: CanvasModel) {
        execute(
            draft => {
                if (loadedModel) {
                    // [核心] 全量替换当前数据
                    // 因为 model 是 reactive，不能直接 model = loadedModel
                    // 需要逐个属性覆盖，或者清空后赋值

                    draft.rootNodes.clear();
                    Object.keys(draft.nodes).forEach(k => delete draft.nodes[k]);
                    draft.edges = [];

                    // 恢复数据
                    Object.assign(draft.nodes, loadedModel.nodes);
                    loadedModel.rootNodes.forEach(id => draft.rootNodes.add(id));
                    draft.edges = loadedModel.edges;
                }
            }
        )
        // 清空撤销/重做历史
        historyStack.value = []
        futureStack.value = []
    }
    //#endregion

    // 辅助：检查 checkId 是否是 rootId 的后代
    function isDescendant(canvasModel: CanvasModel, rootId: string, checkId: string): boolean {
        const root = canvasModel.nodes[rootId];
        if (!root || !root.childrenIds) return false;

        for (const childId of root.childrenIds) {
            if (childId === checkId) return true;
            if (isDescendant(canvasModel, childId, checkId)) return true;
        }
        return false;
    }

    return {
        // State
        model,
        vueNodes,
        vueEdges,
        dragTargetId,
        dragIntent,
        dragDetachId,
        // Actions
        createConnection,
        addContentNode,
        addMindMapRoot,
        addMindMapChildBatch,
        addMindMapSiblingBatch,
        updateNodePosition,
        updateNodeContent,
        updateNodeLink,
        updateNodeData,
        removeNodeFromModel,
        updateEdgesModel,
        updateEdgeLabel,
        syncModelToView,
        moveMindMapNode,
        moveMindMapNodeTo,
        updateNodeSize,
        reportAutoContentSize,
        detachNode,
        // 数据持久化
        saveToFile,
        loadModel,
        // 撤销
        undo, redo
    };
});