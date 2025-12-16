import { type Ref } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { useCanvasStore } from '@/stores/canvasStore'

export function useMindMapKeyboard(
  nodeId: string, 
  selected: Ref<boolean>,
  isEditing: Ref<boolean>
) {
  const store = useCanvasStore()

  // Alt + Arrows: 调整顺序
  onKeyStroke(['ArrowUp', 'ArrowDown'], (e) => {
    if (!selected.value) return
    
    if (e.altKey) {
        e.preventDefault()
        const offset = e.key === 'ArrowUp' ? -1 : 1
        store.moveMindMapNode(nodeId, offset)
    }
  })

  // Space: 进入编辑
  onKeyStroke(' ', (e) => {
    if (!selected.value) return
    
    if (!isEditing.value) {
        e.preventDefault()
        isEditing.value = true
    }
  })
}