<script setup lang="ts">
import { ref, watch, nextTick, computed, onBeforeUnmount } from 'vue'
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

// 初始化编辑器
function initEditor() {
    if (!editorRef.value || view) return

    const state = EditorState.create({
        doc: props.data.content,
        extensions: [
            history(),
            keymap.of([indentWithTab,...defaultKeymap, ...historyKeymap]),
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            EditorView.lineWrapping, // 自动换行

            baseTheme,
            markdownHighlighting,

            // [核心修复 1] 监听失焦事件，实现"无法退出"的修复
            EditorView.updateListener.of((u) => {
                // 如果内容变了，同步数据
                if (u.docChanged) {
                    emit('update:content', u.state.doc.toString())
                }
                // 如果焦点丢失了 (blur)，通知父组件退出编辑
                if (u.focusChanged && !u.view.hasFocus) {
                    emit('blur')
                }
            })
        ]
    })

    view = new EditorView({
        state,
        parent: editorRef.value
    })

    view.focus() // 创建后立即聚焦
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
    }
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
    word-wrap: break-word;
}

/* 基础排版 */
.markdown-body :deep(h1) {
    font-size: 1.6em;
    font-weight: bold;
    margin: 0.5em 0;
    line-height: 1.2;
    border-bottom: 1px solid var(--border-color);
}

.markdown-body :deep(h2) {
    font-size: 1.4em;
    font-weight: bold;
    margin: 0.5em 0;
}

.markdown-body :deep(h3) {
    font-size: 1.2em;
    font-weight: bold;
    margin: 0.5em 0;
}

.markdown-body :deep(p) {
    margin: 0.3em 0;
}

.markdown-body :deep(strong) {
    font-weight: bold;
    color: inherit;
}

.markdown-body :deep(em) {
    font-style: italic;
}

.markdown-body :deep(ul) {
    padding-left: 1.2em;
    list-style: disc;
    margin: 0.2em 0;
}

.markdown-body :deep(ol) {
    padding-left: 1.2em;
    list-style: decimal;
    margin: 0.2em 0;
}

.markdown-body :deep(blockquote) {
    border-left: 3px solid #ddd;
    padding-left: 10px;
    color: #666;
    margin: 0.5em 0;
}

.markdown-body :deep(code) {
    background: rgba(150, 150, 150, 0.2);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: monospace;
}
</style>