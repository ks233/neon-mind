import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// 1. 基础样式 (让它看起来不像代码编辑器)
export const baseTheme = EditorView.theme({
  "&": {
    fontSize: "14px",
    backgroundColor: "transparent",
    height: "100%", 
  },
  ".cm-content": {
    fontFamily: "inherit",
    lineHeight: "1.6",
    padding: "4px 0",
  },
  ".cm-gutters": { display: "none" }, // 隐藏行号
  "&.cm-focused": { outline: "none" } // 移除蓝框
})

// 2. 语法高亮 (关键修复：确保 Bold/Heading 生效)
export const markdownHighlighting = syntaxHighlighting(HighlightStyle.define([
  // 标题
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "bold" },
  { tag: tags.heading2, fontSize: "1.4em", fontWeight: "bold" },
  { tag: tags.heading3, fontSize: "1.2em", fontWeight: "bold" },
  
  // 重点 (粗体/斜体) - 修复颜色问题，确保 inherit
  { tag: tags.strong, fontWeight: "bold", color: "inherit" },
  { tag: tags.emphasis, fontStyle: "italic", color: "inherit" },
  
  // 列表标记
  { tag: tags.list, color: "#888" },
  
  // 引用
  { tag: tags.quote, color: "#666", fontStyle: "italic" },
  
  // 代码块
  { tag: tags.monospace, backgroundColor: "rgba(150,150,150,0.15)", borderRadius: "3px", padding: "0 3px" }
]))