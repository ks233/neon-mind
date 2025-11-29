import { type Ref } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { useCanvasStore } from '@/stores/canvasStore'

export function useMindMapKeyboard(
  nodeId: string, 
  selected: Ref<boolean>, // [!code focus] 新增参数
  isEditing: Ref<boolean>
) {
  const store = useCanvasStore()

  // [!code focus] 移除 target 选项，监听全局键盘事件
  // const options = { target: containerRef } 

  // 1. Tab: 创建子节点
  onKeyStroke('Tab', (e) => {
    // [!code focus:4] 核心修正：只在节点被选中时触发
    if (!selected.value) return 
    
    e.preventDefault()
    store.addMindMapChild(nodeId)
  })

  // 2. Enter: 创建同级节点
  onKeyStroke('Enter', (e) => {
    if (!selected.value) return // [!code focus]
    if (e.shiftKey) return

    e.preventDefault()

    if (isEditing.value) {
        // 编辑模式逻辑：保存并创建
        isEditing.value = false 
        setTimeout(() => store.addMindMapSibling(nodeId), 0)
    } else {
        // 选中模式逻辑：直接创建
        store.addMindMapSibling(nodeId)
    }
  })

  // 3. Alt + Arrows: 调整顺序
  onKeyStroke(['ArrowUp', 'ArrowDown'], (e) => {
    if (!selected.value) return // [!code focus]
    
    if (e.altKey) {
        e.preventDefault()
        const offset = e.key === 'ArrowUp' ? -1 : 1
        store.moveMindMapNode(nodeId, offset)
    }
  })

  // 4. Space: 进入编辑
  onKeyStroke(' ', (e) => {
    if (!selected.value) return // [!code focus]
    
    if (!isEditing.value) {
        e.preventDefault()
        isEditing.value = true
    }
  })
}