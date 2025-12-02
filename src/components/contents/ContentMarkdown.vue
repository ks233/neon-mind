<script setup lang="ts">
import { ref, watch, nextTick, computed, onBeforeUnmount, onMounted } from 'vue'
import MarkdownIt from 'markdown-it'
// CodeMirror 核心
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { languages } from '@codemirror/language-data'
// 导入样式
import { baseTheme, markdownHighlighting } from '@/config/editorTheme'
import type { MarkdownPayload } from '@/types/model'
import { markdownKeymapExtension } from '@/config/markdownCommands';


const props = defineProps<{
    data: MarkdownPayload
    fixedSize?: boolean
    isEditing: boolean
}>()

const emit = defineEmits<{
    (e: 'update:content', val: string): void
    (e: 'blur'): void
}>()

// === 1. 阅读模式逻辑 (MarkdownIt) ===
const md = new MarkdownIt({ html: true, breaks: true })
const renderedHtml = computed(() => md.render(props.data.content || ''))

// === 2. 编辑模式逻辑 (CodeMirror) ===
const editorRef = ref<HTMLElement | null>(null)
let view: EditorView | null = null

let initialContent = ''
let currentContent = ''

// 初始化编辑器
function initEditor() {
    if (!editorRef.value || view) return

    const filteredDefaultKeymap = defaultKeymap.filter(
        (binding) => binding.key !== 'Mod-i'
    )
    initialContent = props.data.content
    currentContent = initialContent
    // 如果不超过 20 字，进入编辑模式后全选
    // 如果超过 20 字，进入编辑模式后
    let selectionRange = { anchor: 0, head: initialContent.length }
    if (initialContent.length > 20) {
        selectionRange.anchor = initialContent.length
    }
    const state = EditorState.create({
        doc: initialContent,
        selection: selectionRange,
        extensions: [
            history(),
            keymap.of([indentWithTab, ...filteredDefaultKeymap, ...historyKeymap]),
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            EditorView.lineWrapping, // 自动换行

            baseTheme,
            markdownHighlighting,

            // [核心修复 1] 监听失焦事件，实现"无法退出"的修复
            EditorView.updateListener.of((u) => {
                const docString = u.state.doc.toString()
                // 如果内容变了，同步数据
                if (u.docChanged) {
                    currentContent = docString
                }
                // 如果焦点丢失了 (blur)，通知父组件退出编辑
                if (u.focusChanged && !u.view.hasFocus) {
                    emit('blur')
                }
            }),
            markdownKeymapExtension,
        ]
    })

    view = new EditorView({
        state,
        parent: editorRef.value
    })

    view.focus() // 创建后立即聚焦
    // 防止聚焦被 VueFlow 抢走
    setTimeout(() => {
        if (view && !view.hasFocus) view.focus();
    }, 10);
}

// 销毁编辑器
function destroyEditor() {
    view?.destroy()
    view = null
}

// 监听编辑状态切换
// 当 isEditing = true 时，DOM 中会出现 editorRef，此时初始化 CM6
// 当 isEditing = false 时，销毁 CM6，显示 HTML 预览
watch(() => props.isEditing, (val) => {
    if (val) {
        nextTick(() => initEditor())
    } else {
        destroyEditor()
        if (currentContent !== initialContent) {
            emit('update:content', currentContent)
        }
    }
})

onMounted(() => {
    // 这里的 setTimeout(0) 是为了给 CSS transition / animation 留一点 buffer
    // 或者是为了确保父级 v-if 产生的 DOM 布局完全稳定 (防止宽高计算错误)
    // 但通常直接 initEditor() 也是稳的。为了极度稳定，可以用 requestAnimationFrame
    requestAnimationFrame(() => {
        initEditor()
    })
})

// 组件卸载时兜底清理
onBeforeUnmount(() => destroyEditor())
</script>

<template>
    <div
        class="md-wrapper"
        :class="{
            'is-fixed': fixedSize,
            'nodrag': isEditing,
            'is-editing': isEditing
        }"
        @keypress.stop
        @keydown.stop
        @keyup.stop>
        <div
            v-if="isEditing"
            ref="editorRef"
            class="cm-container"
            @mousedown.stop
            @scroll.stop
            @wheel.stop></div>

        <div
            v-else
            class="markdown-body"
            v-html="renderedHtml"></div>
    </div>
</template>

<style scoped>
.md-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
}

/* === 滚动条控制 === */
/* 自动大小：禁止滚动，由内容撑开 */
.md-wrapper:not(.is-fixed) {
    height: auto;
    overflow: hidden;
}

/* 固定大小：允许内部滚动 */
.md-wrapper.is-fixed {
    overflow-y: auto;
    scrollbar-width: thin;
}

.md-wrapper.is-editing {
    cursor: text !important;
    user-select: text;
}

/* === CodeMirror 容器 === */
.cm-container {
    height: 100%;
}

/* === Markdown 预览样式 (仿 Obsidian) === */
.markdown-body {
    /* 允许点击穿透，方便未进入编辑时拖拽节点 */
    pointer-events: none;
    user-select: none;

    font-size: 14px;
    line-height: 1.6;
    color: var(--text-color);
    font-family: var(--md-font-family);
    font-size: var(--md-font-size);
    line-height: var(--md-line-height);
    color: var(--md-color);
    word-wrap: break-word;
}

/* 标题 */
.markdown-body :deep(h1) {
    font-size: var(--md-h1-size);
    font-weight: var(--md-h1-weight);
    color: var(--md-h1-color);
    margin: var(--md-h1-margin);
    line-height: 1.2;
    border-bottom: 1px solid var(--border-color);
}

.markdown-body :deep(h2) {
    font-size: var(--md-h2-size);
    font-weight: var(--md-h2-weight);
    color: var(--md-h2-color);
    margin: var(--md-h2-margin);
    line-height: 1.3;
    border-bottom: 1px solid var(--border-color);
}

.markdown-body :deep(h3) {
    font-size: var(--md-h3-size);
    font-weight: var(--md-h3-weight);
    color: var(--md-h3-color);
    margin: var(--md-h3-margin);
}

/* 段落 */
.markdown-body :deep(p) {
    /* CM6 是按行渲染的，行与行之间没有 margin collapse，
     所以这里的 margin 需要微调以匹配 CM6 的视觉感受 */
    margin: 0.3em 0;
}

.markdown-body :deep(p:first-child) {
    margin-top: 0;
}

.markdown-body :deep(p:last-child) {
    margin-bottom: 0;
}

/* 强调 */
.markdown-body :deep(strong) {
    font-weight: var(--md-bold-weight);
    color: var(--md-bold-color);
}

.markdown-body :deep(em) {
    font-style: var(--md-italic-style);
    color: var(--md-bold-color);
}

/* 引用 */
.markdown-body :deep(blockquote) {
    border-left: var(--md-quote-border);
    padding-left: 10px;
    color: var(--md-quote-color);
    margin: 0.5em 0;
}

/* 代码 */
.markdown-body :deep(code) {
    font-family: var(--md-code-font);
    background-color: var(--md-code-bg);
    color: var(--md-code-color);
    border-radius: var(--md-code-radius);
    padding: 0 4px;
}

/* 链接 */
.markdown-body :deep(a) {
    color: var(--md-link-color);
    text-decoration: var(--md-link-decoration);
}

/* 列表 */
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
    padding-left: 1.2em;
    /* margin: 0.2em 0; */
}
</style>