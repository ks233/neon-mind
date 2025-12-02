// src/composables/useGlobalShortcuts.ts 最终推荐版
import { onKeyStroke } from '@vueuse/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { isInputActive } from '@/utils/keyboard'
import { GraphNode, isGraphNode, useVueFlow } from '@vue-flow/core'
import { nextTick } from 'vue'
import { PersistenceManager } from '@/services/persistence/PersistenceManager'
import UniversalNode from '@/components/UniversalNode.vue'

export function useGlobalShortcuts() {
    const store = useCanvasStore()

    const { addSelectedNodes, removeSelectedNodes, getSelectedNodes, findNode } = useVueFlow()

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
        if(getSelectedNodes.value.length == 1){
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
            const newModel = await PersistenceManager.openProject();
            if (newModel) {
                // 清空并加载
                store.loadModel(newModel);
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

    // debug 用
    onKeyStroke(['d', 'D'], (e) => {
        console.log('ctrl', e.ctrlKey)
        console.log('meta', e.metaKey)
        console.log('shift', e.shiftKey)
    })
}