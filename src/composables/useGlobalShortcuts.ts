// src/composables/useGlobalShortcuts.ts 最终推荐版
import { onKeyStroke } from '@vueuse/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { isInputActive } from '@/utils/keyboard'
import { GraphNode, isGraphNode, useVueFlow } from '@vue-flow/core'
import { nextTick } from 'vue'
import { PersistenceManager } from '@/services/persistence/PersistenceManager'

export function useGlobalShortcuts() {
    const store = useCanvasStore()

    const { addSelectedNodes, removeSelectedNodes, getSelectedNodes, findNode, getNodes } = useVueFlow()

    // [!code focus:15] 全局处理 Tab 键
    onKeyStroke('Tab', async (e) => {
        e.preventDefault();
        // 如果正在编辑文本，不要拦截 (由 ContentMarkdown 内部 stop 阻止冒泡)
        if (isInputActive()) return;
        const selectedNodes = getSelectedNodes.value;
        if (selectedNodes.length === 0) return;

        // 筛选出思维导图节点 (游离节点按 Tab 可能不产生子节点，看你需求)
        // 注意：这里拿到的 node.id 就是我们需要传给 store 的 parentId
        const targetIds = selectedNodes // 假设你有区分类型或标记
            .map(n => n.id);

        if (targetIds.length > 0) {

            console.time('Batch Add Child');
            const newIds = await store.addMindMapChildBatch(targetIds);
            console.timeEnd('Batch Add Child');
            if (newIds.length > 0) {
                // 必须等待 Vue 将新数据渲染成 DOM/GraphNode
                await nextTick();

                // 清空旧选中
                removeSelectedNodes(selectedNodes);
                store.stopEditing();
                // 查找新节点实例 (GraphNode)
                const newGraphNodes = newIds
                    .map(id => findNode(id))
                    .filter((n): n is GraphNode => typeof n !== 'undefined'); // 过滤掉潜在的 undefined

                if (newGraphNodes.length == 1) {
                    store.startEditing(newGraphNodes[0].id)
                }
                // 批量选中
                addSelectedNodes(newGraphNodes);
            }
        }
    });

    onKeyStroke('Enter', async (e) => {
        e.preventDefault();
        // 如果正在编辑文本，不要拦截 (由 ContentMarkdown 内部 stop 阻止冒泡)
        if (isInputActive()) return;
        const selectedNodes = getSelectedNodes.value;

        if (selectedNodes.length === 0) return;
        const targetIds = selectedNodes
            .map(n => n.id);

        if (targetIds.length > 0) {

            console.time('Batch Add Sibling');
            const newIds = await store.addMindMapSiblingBatch(targetIds);
            console.timeEnd('Batch Add Sibling');

            if (newIds.length > 0) {
                await nextTick();
                removeSelectedNodes(selectedNodes);
                const newGraphNodes = newIds
                    .map(id => findNode(id))
                    .filter((n): n is GraphNode => typeof n !== 'undefined'); // 过滤掉潜在的 undefined

                if (newGraphNodes.length == 1) {
                    store.startEditing(newGraphNodes[0].id)
                }

                addSelectedNodes(newGraphNodes);
            }
        }
    });

    onKeyStroke('F2', async (e) => {
        console.log('f2')
        if (getSelectedNodes.value.length == 1) {
            const selectedNode = getSelectedNodes.value[0]
            store.startEditing(selectedNode.id)
        }
    })

    // 保存
    onKeyStroke('s', async (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            // 如果已经有路径，可以直接保存(覆盖)；如果没有，另存为
            // 这里简化为每次都另存为
            await PersistenceManager.saveProjectAs(store.model);
        }
    });

    // 打开
    onKeyStroke('o', async (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const result = await PersistenceManager.openProject();
            if (result) {
                const { model: loadedModel, projectRoot: rootPath } = result;
                await store.setProjectRoot(rootPath);
                // 清空并加载
                store.loadModel(loadedModel);
            }
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
                store.undo();
            } else {
                e.preventDefault();
                console.log('触发重做');
                store.redo();
            }
        }
    })


    // 重做 (Ctrl-Y)
    onKeyStroke(['y', 'Y'], (e) => {
        if (e.ctrlKey || e.metaKey) {
            if (isInputActive()) return;

            e.preventDefault();
            console.log('触发重做');
            store.redo();
        }
    })

    // [!code focus:60] === 新增：思维导图方向键导航 ===
    onKeyStroke(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], (e) => {
        // 1. 基础拦截：编辑中、组合键按下时不触发
        if (isInputActive()) return
        if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return

        // 2. 只有单选模式下生效
        const selected = getSelectedNodes.value
        if (selected.length !== 1) return

        e.preventDefault() // 阻止页面滚动

        const currentId = selected[0].id
        const logicNode = store.model.nodes[currentId]
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
            const currentNode = selected[0]
            const currentDepth = currentNode.data.depth ?? 0
            const currentRootId = currentNode.data.rootId
            // 1. 获取画布上所有节点 (Visual Nodes)
            const allNodes = getNodes.value

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
            const targetGraphNode = findNode(nextId)
            if (targetGraphNode) {
                // 切换选中
                removeSelectedNodes(getSelectedNodes.value)
                addSelectedNodes([targetGraphNode])

                // 可选：平滑移动视口跟随 (Center View)
                // 如果节点在屏幕外，这一步很有用，但也可能导致画面晃动，视需求开启
                // useVueFlow().fitView({ nodes: [targetGraphNode], duration: 200, padding: 0.5 })
            }
        }
    })

    // Delete / Backspace
    onKeyStroke(['Delete', 'Backspace'], (e) => {
        if (isInputActive()) return; // 编辑文字时不删除

        e.preventDefault();
        console.log('执行智能删除...');

        // 调用新的 Action
        store.deleteSelectedNodes();
    });

    // debug 用
    onKeyStroke(['d', 'D'], (e) => {
        console.log('ctrl', e.ctrlKey)
        console.log('meta', e.metaKey)
        console.log('shift', e.shiftKey)
    })
}