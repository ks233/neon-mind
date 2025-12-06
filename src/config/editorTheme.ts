import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// 1. 容器与基础样式
export const baseTheme = EditorView.theme({
    "&": {
        fontSize: "var(--md-font-size)",
        backgroundColor: "transparent",
        height: "100%",
        color: "var(--md-color)",
        fontFamily: "var(--md-font-family)",
    },
    ".cm-content": {
        padding: "4px 0", // 与预览模式的 padding 保持一致
        lineHeight: "var(--md-line-height)",
        fontFamily: "var(--md-font-family) !important",
        caretColor: "var(--md-color)",
    },
    ".cm-gutters": { display: "none" },
    "&.cm-focused": { outline: "none" },

    // 修正：让 CM6 的行间距与 Markdown P 标签的 margin 尽量接近
    ".cm-line": {
        padding: "0",
        lineHeight: "var(--md-line-height)"
    },
    ".cm-lineWrapping": {
        padding: "0"
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
        // 这里使用 淡蓝色 (Unity/VSCode 风格)
        backgroundColor: "var(--md-selection-bg) !important",
    },
})

// 2. 语法高亮 (映射到 CSS 变量)
export const markdownHighlighting = syntaxHighlighting(HighlightStyle.define([
    // 标题
    {
        tag: tags.heading1,
        fontSize: "var(--md-h1-size)",
        fontWeight: "var(--md-h1-weight)",
        color: "var(--md-h1-color)",
    },
    {
        tag: tags.heading2,
        fontSize: "var(--md-h2-size)",
        fontWeight: "var(--md-h2-weight)",
        color: "var(--md-h2-color)",
    },
    {
        tag: tags.heading3,
        fontSize: "var(--md-h3-size)",
        fontWeight: "var(--md-h3-weight)",
        color: "var(--md-h3-color)"
    },

    // 强调
    { tag: tags.strong, fontWeight: "var(--md-bold-weight)", color: "var(--md-bold-color)" },
    { tag: tags.emphasis, fontStyle: "var(--md-italic-style)", color: "var(--md-bold-color)" },

    // 引用
    { tag: tags.quote, color: "var(--md-quote-color)", fontStyle: "italic" },

    // 代码
    {
        tag: tags.monospace,
        fontFamily: "var(--md-code-font)",
        backgroundColor: "var(--md-code-bg)",
        color: "var(--md-code-color)",
        borderRadius: "var(--md-code-radius)",
        padding: "0 4px"
    },

    // 链接
    { tag: tags.link, color: "var(--md-link-color)", textDecoration: "var(--md-link-decoration)" },

    // 列表符号
    { tag: tags.list }
]))