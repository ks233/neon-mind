// src/composables/useGlobalShortcuts.ts 最终推荐版
import { onKeyStroke } from '@vueuse/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { isInputActive } from '@/utils/keyboard'

export function useGlobalShortcuts() {
  const store = useCanvasStore()

  // 1. 保存 (Ctrl + S)
  onKeyStroke('s', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      // store.saveProject()
    }
  })

  // 2. 撤销/重做 (Ctrl + Z / Ctrl + Y)
  onKeyStroke('z', (e) => {
    if ((e.ctrlKey || e.metaKey) && !isInputActive()) {
      e.preventDefault()
      if (e.shiftKey) {
        // store.redo()
      } else {
        // store.undo()
      }
    }
  })
  
  // 3. 重做 (Ctrl + Y) - Windows 习惯
  onKeyStroke('y', (e) => {
    if ((e.ctrlKey || e.metaKey) && !isInputActive()) {
       e.preventDefault()
       // store.redo()
    }
  })

  // 4. 删除 (Delete / Backspace)
  onKeyStroke(['Delete', 'Backspace'], (e) => {
    if (!isInputActive()) {
      // store.removeSelectedElements()
    }
  })
}