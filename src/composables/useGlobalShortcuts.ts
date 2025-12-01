// src/composables/useGlobalShortcuts.ts 最终推荐版
import { onKeyStroke } from '@vueuse/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { isInputActive } from '@/utils/keyboard'
import { GraphNode, isGraphNode, useVueFlow } from '@vue-flow/core'
import { nextTick } from 'vue'
import { PersistenceManager } from '@/services/persistence/PersistenceManager'

export function useGlobalShortcuts() {
    const store = useCanvasStore()

    const { addSelectedNodes, removeSelectedNodes, getSelectedNodes, findNode } = useVueFlow()

    // [!code focus:15] 全局处理 Tab 键
    onKeyStroke('Tab', async (e) => {
        // 如果正在编辑文本，不要拦截 (由 ContentMarkdown 内部 stop 阻止冒泡)
        if (isInputActive()) return;

        e.preventDefault();

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
            // 2. [优雅的选中逻辑]
            if (newIds.length > 0) {
                // 必须等待 Vue 将新数据渲染成 DOM/GraphNode
                await nextTick();

                // 清空旧选中
                removeSelectedNodes(selectedNodes);

                // 查找新节点实例 (GraphNode)
                const newGraphNodes = newIds
                    .map(id => findNode(id))
                    .filter((n): n is GraphNode => typeof n !== 'undefined'); // 过滤掉潜在的 undefined

                // 批量选中
                addSelectedNodes(newGraphNodes);
            }
        }
    });

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

    // // 2. 撤销/重做 (Ctrl + Z / Ctrl + Y)
    // onKeyStroke('z', (e) => {
    //     if ((e.ctrlKey || e.metaKey) && !isInputActive()) {
    //         e.preventDefault()
    //         if (e.shiftKey) {
    //             // store.redo()
    //         } else {
    //             // store.undo()
    //         }
    //     }
    // })

    // // 3. 重做 (Ctrl + Y) - Windows 习惯
    // onKeyStroke('y', (e) => {
    //     if ((e.ctrlKey || e.metaKey) && !isInputActive()) {
    //         e.preventDefault()
    //         // store.redo()
    //     }
    // })

    // // 4. 删除 (Delete / Backspace)
    // onKeyStroke(['Delete', 'Backspace'], (e) => {
    //     if (!isInputActive()) {
    //         // store.removeSelectedElements()
    //     }
    // })
}