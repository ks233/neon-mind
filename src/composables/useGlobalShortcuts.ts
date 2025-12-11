// src/composables/useGlobalShortcuts.ts 最终推荐版
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'
import { isInputActive } from '@/utils/keyboard'
import { onKeyStroke } from '@vueuse/core'
import { nextTick } from 'vue'

export function useGlobalShortcuts() {
    const canvasStore = useCanvasStore()
    const uiStore = useUiStore()
    const projectStore = useProjectStore()

    // [!code focus:15] 全局处理 Tab 键
    onKeyStroke('Tab', async (e) => {
        e.preventDefault();
        // 如果正在编辑文本，不要拦截 (由 ContentMarkdown 内部 stop 阻止冒泡)
        if (isInputActive()) return;
        const targetIds = uiStore.getSelectedNodeIds();

        if (targetIds.length > 0) {
            console.time('Batch Add Child');
            const newIds = await canvasStore.addMindMapChildBatch(targetIds);
            console.timeEnd('Batch Add Child');
            postBatchAdd(newIds)
        }
    });

    onKeyStroke('Enter', async (e) => {
        e.preventDefault();
        // 如果正在编辑文本，不要拦截 (由 ContentMarkdown 内部 stop 阻止冒泡)
        if (isInputActive()) return;
        const targetIds = uiStore.getSelectedNodeIds();
        if (targetIds.length > 0) {
            console.time('Batch Add Sibling');
            const newIds = await canvasStore.addMindMapSiblingBatch(targetIds);
            console.timeEnd('Batch Add Sibling');
            postBatchAdd(newIds)
        }
    });

    async function postBatchAdd(newIds: string[]) {
        if (newIds.length == 0) return
        // 必须等待 Vue 将新数据渲染成 DOM/GraphNode
        await nextTick();
        // 清空旧选中
        uiStore.clearSelection();
        uiStore.stopEditing();

        // 查找新节点实例 (GraphNode)
        const newGraphNodes = uiStore.getGraphNodes(newIds)
        if (newGraphNodes.length == 1) {
            uiStore.startEditing(newGraphNodes[0].id)
        }
        // 批量选中
        uiStore.selectNodes(newGraphNodes);
    }

    onKeyStroke('F2', async (e) => {
        console.log('f2')
        uiStore.startEditSelectedNode()
    })

    // 保存
    onKeyStroke(['s', 'S'], async (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            console.log('hi')
            if (e.shiftKey) {
                await projectStore.saveAs();
            } else {
                await projectStore.save();
            }
        }
    });

    // 打开
    onKeyStroke('o', async (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            projectStore.open()
        }
    });

    onKeyStroke('n', async (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            projectStore.newProject()
        }
    });

    // 撤销和重做 (Ctrl-Z、Ctrl-Shift-Z)
    // 巨坑：一定要同时监听大写和小写，否则 shiftKey 始终为 false
    onKeyStroke(['z', 'Z'], (e) => {
        if ((e.ctrlKey || e.metaKey)) {
            if (isInputActive()) return; // 编辑文字时交给 CodeMirror
            if (!e.shiftKey) {
                e.preventDefault();
                console.log('触发撤销');
                canvasStore.undo();
            } else {
                e.preventDefault();
                console.log('触发重做');
                canvasStore.redo();
            }
        }
    })


    // 重做 (Ctrl-Y)
    onKeyStroke(['y', 'Y'], (e) => {
        if (e.ctrlKey || e.metaKey) {
            if (isInputActive()) return;

            e.preventDefault();
            console.log('触发重做');
            canvasStore.redo();
        }
    })

    // [!code focus:60] === 新增：思维导图方向键导航 ===
    onKeyStroke(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], (e) => {
        // 1. 基础拦截：编辑中、组合键按下时不触发
        if (isInputActive()) return
        if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return

        // 2. 只有单选模式下生效
        const selectedIds = uiStore.getSelectedNodeIds()
        if (selectedIds.length !== 1) return

        e.preventDefault() // 阻止页面滚动

        const currentId = selectedIds[0]
        const logicNode = canvasStore.model.nodes[currentId]
        if (!logicNode) return

        let nextId: string | undefined

        // === 逻辑分发 ===
        if (e.key === 'ArrowLeft') {
            // 向左：回父节点
            if (logicNode.parentId) {
                nextId = logicNode.parentId
            }
        }
        else if (e.key === 'ArrowRight') {
            // 向右：去子节点
            // 策略：默认选中中间的子节点，体验最好
            const children = logicNode.childrenIds
            if (children && children.length > 0) {
                const mid = Math.ceil(children.length / 2) - 1
                nextId = children[mid]
            }
        }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const currentNode = uiStore.getGraphNode(selectedIds[0])
            if (!currentNode) return;
            const currentDepth = currentNode.data.depth ?? 0
            const currentRootId = currentNode.data.rootId
            // 1. 获取画布上所有节点 (Visual Nodes)
            const allNodes = uiStore.getAllGraphNodes()

            // 2. 筛选出所有处于"同一深度"的节点
            // 并且必须是思维导图节点(根据需求，也可以包含游离节点，只要 depth 匹配)
            const sameLevelNodes = allNodes.filter(
                n => n.data.depth === currentDepth &&
                    n.data.rootId === currentRootId
            )

            // 3. 按照 Y 轴坐标进行视觉排序
            // 这样"上"就真的是视觉上的"上方"，"下"就是"下方"
            sameLevelNodes.sort((a, b) => a.position.y - b.position.y)

            // 4. 找到当前节点在排序列表中的位置
            const currentIndex = sameLevelNodes.findIndex(n => n.id === currentId)

            if (currentIndex !== -1) {
                if (e.key === 'ArrowUp' && currentIndex > 0) {
                    nextId = sameLevelNodes[currentIndex - 1].id
                } else if (e.key === 'ArrowDown' && currentIndex < sameLevelNodes.length - 1) {
                    nextId = sameLevelNodes[currentIndex + 1].id
                }
            }
        }

        // === 执行选中 ===
        if (nextId) {
            // 切换选中
            uiStore.clearSelection()
            uiStore.selectNodeById(nextId)

            // 可选：平滑移动视口跟随 (Center View)
            // 如果节点在屏幕外，这一步很有用，但也可能导致画面晃动，视需求开启
            // useVueFlow().fitView({ nodes: [targetGraphNode], duration: 200, padding: 0.5 })
        }
    })

    // Delete / Backspace
    onKeyStroke(['Delete', 'Backspace'], (e) => {
        if (isInputActive()) return; // 编辑文字时不删除
        e.preventDefault();
        console.log('执行智能删除...');
        const selectedIds = uiStore.getSelectedNodeIds();
        // 调用新的 Action
        const nextToSelect = canvasStore.deleteSelectedNodes(selectedIds);
        console.log(nextToSelect)
        if (nextToSelect) {
            uiStore.selectNodeById(nextToSelect)
        }
    });

    onKeyStroke('p', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            // 1. 获取选中 ID
            let selectedIds = uiStore.getSelectedNodeIds();

            if (selectedIds.length === 0) {
                selectedIds = uiStore.getAllNodeIds()
            }
            // 2. 获取几何快照 (传入 model.nodes 以便读取结构关系)
            const geometryMap = uiStore.getGeometryMap(canvasStore.model.nodes);

            // 3. 执行排版
            canvasStore.packNodes(selectedIds, geometryMap);
        }
    });


    onKeyStroke(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (isInputActive()) return;

        e.preventDefault();
        e.stopPropagation();

        const canvasStore = useCanvasStore();
        const uiStore = useUiStore();

        const selectedIds = uiStore.getSelectedNodeIds();
        if (selectedIds.length < 2) return;
        const geometryMap = uiStore.getGeometryMap(canvasStore.model.nodes);

        // [修改] 调用 compactNodes
        switch (e.key) {
            case 'ArrowLeft':
                canvasStore.compactNodes(selectedIds, geometryMap, 'left');
                break;
            case 'ArrowRight':
                canvasStore.compactNodes(selectedIds, geometryMap, 'right');
                break;
            case 'ArrowUp':
                canvasStore.compactNodes(selectedIds, geometryMap, 'top');
                break;
            case 'ArrowDown':
                canvasStore.compactNodes(selectedIds, geometryMap, 'bottom');
                break;
        }
    });

    // debug 用
    onKeyStroke(['d', 'D'], (e) => {
        console.log('ctrl', e.ctrlKey)
        console.log('meta', e.metaKey)
        console.log('shift', e.shiftKey)
    })
}