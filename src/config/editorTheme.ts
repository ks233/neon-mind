import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// 1. 容器与基础样式
export const baseTheme = EditorView.theme({
    "&": {
        fontSize: "var(--md-font-size)",
        backgroundColor: "transparent",
        height: "100%",
        color: "var(--md-color)"
    },
    ".cm-content": {
        padding: "4px 0", // 与预览模式的 padding 保持一致
        lineHeight: "var(--md-line-height)",
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

export const markdownFontTheme = EditorView.theme({
    "&": {
        fontFamily: "var(--md-font-family) !important",
    },
    ".cm-content": {
        fontFamily: "var(--md-font-family) !important",
    }
})

export const codeFontTheme = EditorView.theme({
    "&": {
        fontFamily: "var(--md-code-font) !important",
    },
    ".cm-content": {
        fontFamily: "var(--md-code-font) !important",
    }
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
    { tag: tags.list },


    // === [新增] 代码块语法高亮 (Atom One Dark 风格) ===
    // 这种风格能确保编辑时的代码颜色与 highlight.js 的 atom-one-dark.css 一致

    // 关键字 (紫色)
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "#c678dd" },

    // 字符串 (绿色)
    { tag: [tags.string, tags.special(tags.string)], color: "#98c379" },

    // 数字、布尔值、常量 (橙色)
    { tag: [tags.number, tags.bool, tags.atom, tags.constant(tags.variableName)], color: "#d19a66" },

    // 变量名、属性名 (红色)
    { tag: [tags.variableName, tags.attributeName, tags.propertyName, tags.labelName], color: "#abb2bf" },

    // 函数名 (蓝色)
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#61afef" },

    // 类型、类名 (黄色)
    { tag: [tags.typeName, tags.className, tags.standard(tags.string)], color: "#e5c07b" },

    // 运算符、正则、特殊字符 (青色)
    { tag: [tags.operator, tags.regexp, tags.escape, tags.special(tags.string)], color: "#56b6c2" },

    // 注释 (灰色斜体)
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#5c6370", fontStyle: "italic" },

    // 标点符号 (默认前景色)
    { tag: [tags.punctuation, tags.bracket], color: "#abb2bf" },
]))