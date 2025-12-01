import { defineStore } from 'pinia';
import { nextTick, reactive, ref, shallowRef, toRaw } from 'vue';
import type { CanvasModel, LogicNode, LogicEdge, MarkdownPayload, ImagePayload, LinkPayload } from '../types/model';
import type { Node, Edge, XYPosition, Connection, GraphNode } from '@vue-flow/core';
import { useVueFlow } from '@vue-flow/core';

import { computeMindMapLayout } from '@/services/layoutService';

import { useDebounceFn } from '@vueuse/core';
import { NODE_CONSTANTS } from '@/config/layoutConfig';
import { fetchLinkMetadata } from '@/services/linkService';
import { convertFileSrc } from '@tauri-apps/api/core';

export const useCanvasStore = defineStore('canvas', () => {
    // #region 全局数据
    const model = reactive<CanvasModel>({
        rootNodes: new Set(),
        nodes: {},
        edges: [] // 存储非树状结构的额外连线
    });
    const {
        addSelectedNodes,
        removeSelectedNodes,
        getSelectedNodes, findNode
    } = useVueFlow();
    function selectNode(id: string) {
        vueNodes.value.forEach(node => {
            if (node.id === id) {
                (node as GraphNode).selected = true; // 标记为选中
            } else {
                // node.selected = false; // 其他取消选中
            }
        });
    }

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
            const layoutData = await computeMindMapLayout(rootNode, model.nodes);
            nextNodes.push(...layoutData.nodes);
            nextEdges.push(...layoutData.edges);
        }

        // 3. 提交到显存
        vueNodes.value = nextNodes;
        vueEdges.value = nextEdges;

    }
    //#endregion

    // #region 【UI -> 数据】增

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

        let payload: any;

        // 1. 构造图片节点数据
        if (type === 'image') {
            let url = ''
            if (data instanceof File) {
                url = URL.createObjectURL(data); // MVP: 使用 Blob URL
            } else {
                url = convertFileSrc(data);
                console.log('aaa', url)
            }

            payload = {
                ...baseNode,
                contentType: 'image',
                src: url,
                ratio: 1, // 初始比例，组件加载完会更新
                width: 200, // 默认宽
                // height 会由 Layout 根据 ratio 算出来
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
                    metaDescription: meta.desc,
                    metaImage: meta.image
                });
            });
        }

        if (payload) {
            model.nodes[id] = payload;

            if (parentId) {
                // 如果是作为子节点插入
                const parent = model.nodes[parentId];
                if (parent) parent.childrenIds.push(id);
            } else {
                // 如果是作为游离节点
                model.rootNodes.add(id);
            }

            await syncModelToView();
        }
    }


    // 添加思维导图根节点
    async function addMindMapRoot(x: number, y: number) {
        const id = crypto.randomUUID();
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

        model.nodes[id] = newNode;
        model.rootNodes.add(id);

        await syncModelToView();
        selectNode(id)
        return id;
    }

    // 添加思维导图子节点
    async function addMindMapChild(parentId: string) {
        const parent = model.nodes[parentId];
        if (!parent) return;

        const newId = crypto.randomUUID();
        const newNode: MarkdownPayload = {
            id: newId,
            structure: 'node',
            contentType: 'markdown', // 子节点类型
            content: `Child ${parent.childrenIds.length + 1}`,
            parentId: parentId,
            x: 0,
            y: 0,
            width: NODE_CONSTANTS.MIN_WIDTH,
            height: NODE_CONSTANTS.MIN_HEIGHT,
            childrenIds: []
        };

        // 更新 Model
        model.nodes[newId] = newNode;
        parent.childrenIds.push(newId);

        // 重新计算布局
        await syncModelToView();

        selectNode(newId)
    }

    async function addMindMapChildBatch(parentIds: string[]) : Promise<string[]> {
        if (parentIds.length === 0) return [];

        const newIds: string[] = [];
        // 1. 批量更新数据模型 (纯 JS 操作，极快)
        parentIds.forEach(parentId => {
            const parent = model.nodes[parentId];
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

            model.nodes[newId] = newNode;
            parent.childrenIds.push(newId);
            newIds.push(newId);
        });
        // 2. [关键] 只触发一次视图同步和排版
        await syncModelToView();

        console.log('before', getSelectedNodes.value)
        // 3. (可选) 选中所有新生成的节点？或者保持原样
        // 选中逻辑也可以批量化，这里暂时略过        
        console.log(getSelectedNodes.value)
        removeSelectedNodes(getSelectedNodes.value)
        return newIds
        // addSelectedNodes(nodesToSelect.map(id => findNode(id) as GraphNode))
    }

    // 添加思维导图同级节点
    async function addMindMapSibling(currentNodeId: string) {
        const current = model.nodes[currentNodeId];
        if (!current || !current.parentId) return; // 根节点没有同级

        const parent = model.nodes[current.parentId];
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
            width: NODE_CONSTANTS.MIN_WIDTH,
            height: NODE_CONSTANTS.MIN_HEIGHT,
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

        await syncModelToView();

        // 返回新 ID 以便组件聚焦
        return newId;
    }
    //#endregion

    // #region 【UI -> 数据】删

    // 5. 递归删除节点
    async function removeNodeFromModel(id: string) {
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
        model.rootNodes.delete(id);

        // D. 处理游离连线引用
        model.edges = model.edges.filter(e => e.source !== id && e.target !== id);

        // E. 物理删除
        delete model.nodes[id];

        // 触发重绘 (如果是 VueFlow 的事件回调触发的，可能不需要这步，但为了安全起见)
        // 这里的策略是：如果是 Delete 键触发的，视图已经没了，我们只改 Model
        // 如果是代码逻辑触发的，我们需要 sync
        await syncModelToView()
    }

    //#endregion

    // #region 【UI -> 数据】改

    // 更新节点位置 (仅针对 Root 或 Free 节点)
    function updateNodePosition(id: string, position: XYPosition) {
        const node = model.nodes[id];
        if (!node) return;
        node.x = position.x;
        node.y = position.y

    }

    function updateNodeSize(id: string, size: { width: number, height: number }) {
        const node = model.nodes[id];
        if (node) {
            node.width = size.width;
            node.height = size.height;
            node.fixedSize = true;
            // 使用防抖 (Debounce) 或直接调用，取决于性能要求
            debouncedLayout();
        }
    }

    // 更新内容
    function updateNodeContent(id: string, content: string) {
        const node = model.nodes[id] as MarkdownPayload;
        if (node) {
            node.content = content;
            // 如果内容变长了，可能影响布局，建议触发一次轻量级重排
            // syncModelToView(); 
        }
    }

    async function updateNodeLink(id: string, url: string) {
        const node = model.nodes[id];
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
    }

    // 用于更新节点的任意属性 (Partial<LogicNode>)
    function updateNodeData(id: string, data: Partial<LogicNode>) {
        const node = model.nodes[id];
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
            // 如果没有 debouncedLayout，直接调 syncModelToView();
        }
    }

    // 仅当 fixedSize = false 时调用
    function reportAutoContentSize(id: string, size: { width: number, height: number }) {
        const node = model.nodes[id];
        if (node && !node.fixedSize) {
            // 只有当尺寸真的变了才更新，避免死循环
            if (node.width !== size.width || node.height !== size.height) {
                node.width = size.width;
                node.height = size.height;
                debouncedLayout();
            }
        }
    }

    // 防抖的布局函数，避免打字时每帧都重排
    const debouncedLayout = useDebounceFn(() => {
        syncModelToView();
    }, 300);
    //#endregion

    // #region 【UI -> 数据】移
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

        if (newParentId) {
            setAsChild(sourceId, newParentId)
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
    // #endregion

    // #region 【UI -> 数据】刷新
    function updateEdgesModel(viewEdges: Edge[]) {
        // 找出所有非生成的线（即 id 不是 e-parent-child 格式的）
        // 或者是我们在 createVisualNode 里标记过的
        const manualEdges = viewEdges.filter(e => !e.id.startsWith('e-'));

        model.edges = manualEdges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,

            sourceHandle: e.sourceHandle ?? undefined,
            targetHandle: e.targetHandle ?? undefined,
        }));
    }

    // Store Action
    function setAsRoot(id: string) {
        const node = model.nodes[id];
        if (!node) return; // 1. 防御性检查：节点是否存在

        // 如果已经是根节点，直接跳过（避免重复添加）
        if (model.rootNodes.has(id)) return;

        // 2. 处理旧父级关系
        if (node.parentId) {
            const parent = model.nodes[node.parentId];
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
        model.rootNodes.add(id);

        // 5. 触发视图更新
        syncModelToView();
    }

    function setAsChild(id: string, parentId: string) {
        const node = model.nodes[id];
        const oldParentId = node.parentId
        if (oldParentId) {
            const oldParent = model.nodes[oldParentId]
            const index = oldParent.childrenIds.indexOf(id);
            if (index !== -1) {
                oldParent.childrenIds.splice(index, 1);
            }
        }
        node.parentId = parentId
        node.structure = 'node'
        model.rootNodes.delete(id);
    }

    //#endregion

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
        dragTargetId,
        dragIntent,
        dragDetachId,
        // Actions
        addContentNode,
        addMindMapRoot,
        addMindMapChild,
        addMindMapChildBatch,
        updateNodePosition,
        updateNodeContent,
        updateNodeLink,
        updateNodeData,
        removeNodeFromModel,
        updateEdgesModel,
        syncModelToView,
        addMindMapSibling,
        moveMindMapNode,
        moveMindMapNodeTo,
        updateNodeSize,
        reportAutoContentSize,
        setAsRoot
    };
});