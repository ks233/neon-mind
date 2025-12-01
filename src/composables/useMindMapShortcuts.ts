import { type Ref } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { useCanvasStore } from '@/stores/canvasStore'

export function useMindMapKeyboard(
  nodeId: string, 
  selected: Ref<boolean>, // [!code focus] 新增参数
  isEditing: Ref<boolean>
) {
  const store = useCanvasStore()

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