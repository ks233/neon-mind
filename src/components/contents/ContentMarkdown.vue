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
import { useCanvasStore } from '@/stores/canvasStore'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useProjectStore } from '@/stores/projectStore'
import { openPath, openUrl } from '@tauri-apps/plugin-opener';

const props = defineProps<{
    data: MarkdownPayload
    fixedSize?: boolean
    isEditing: boolean
}>()

const emit = defineEmits<{
    (e: 'update:content', val: string): void
    (e: 'blur'): void
    (e: 'command', key: string): void
}>()
// [!code focus:3] 1. 引入 highlight.js 核心和样式
import hljs from 'highlight.js'
// 你可以在 node_modules/highlight.js/styles/ 下挑选喜欢的颜色主题，例如 github.css, atom-one-dark.css 等
import 'highlight.js/styles/atom-one-dark.css'
//#region === 1. 阅读模式逻辑 (MarkdownIt) ===
const md = new MarkdownIt(
    {
        html: true,
        breaks: true,
        linkify: true,
        highlight: function (str, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    // 使用 highlight.js 进行解析
                    return '<pre class="hljs"><code>' +
                        hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                        '</code></pre>';
                } catch (__) { }
            }

            // 默认回退：普通转义
            return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
        }
    }
)

// 保存默认的渲染函数
const defaultImageRender = md.renderer.rules.image || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
}

const projectStore = useProjectStore()

// 配置 Markdown-it 给链接添加 nodrag 类
// 1. 保存默认的 link_open 渲染规则
const defaultLinkRender = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
}

// 2. 覆盖规则
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]

    // 添加 'nodrag' 类：这是 Vue Flow 的关键词，阻止事件冒泡触发拖拽
    const existingClass = token.attrGet('class') || ''
    token.attrSet('class', `${existingClass} nodrag`.trim())

    // 添加 target="_blank"
    token.attrSet('target', '_blank')

    return defaultLinkRender(tokens, idx, options, env, self)
}

md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const srcIndex = token.attrIndex('src')

    if (srcIndex >= 0) {
        const src = token.attrs![srcIndex][1]
        // 检查是否是相对路径 (以 ./ 或 ../ 开头，或者不包含 ://)
        // 简单起见，我们主要处理 ./assets/ 这种情况
        if (projectStore.projectDir && (src.startsWith('./') || src.startsWith('assets/'))) {
            try {
                // 1. 简单的路径清洗 (移除 ./)
                const cleanRelPath = src.replace(/^\.\//, '')

                // 2. 拼接绝对路径 (注意：这里在前端做简单的字符串拼接)
                // 我们需要处理 Windows (\) 和 Unix (/) 的分隔符差异
                // 但 convertFileSrc 对斜杠通常有很好的兼容性
                const isWindows = navigator.userAgent.includes('Windows')
                const sep = isWindows ? '\\' : '/'

                // 简单拼接：Root + Sep + Relative
                // 注意处理 projectRoot 末尾可能已有斜杠的情况
                const root = projectStore.projectDir.endsWith(sep)
                    ? projectStore.projectDir
                    : projectStore.projectDir + sep

                const absolutePath = root + cleanRelPath.replace(/\//g, sep)
                // 3. 转换为 WebView 协议 (asset://)
                const assetUrl = convertFileSrc(absolutePath)
                console.log(absolutePath, assetUrl)
                // 4. 覆写 src 属性
                token.attrs![srcIndex][1] = assetUrl

            } catch (e) {
                console.error('Markdown image path resolve failed:', e)
            }
        }
    }

    // 调用默认渲染器生成 HTML
    return defaultImageRender(tokens, idx, options, env, self)
}

// 允许点击链接，并使用 tauri api 打开
async function onContentClick(e: MouseEvent) {
    // 使用事件委托，检查点击的是否是链接
    const target = e.target as HTMLElement
    const link = target.closest('a')
    if (link && link.href) {
        // 1. 阻止 WebView 默认跳转 (非常重要！)
        e.preventDefault()
        // 2. 调用 Tauri 系统 API 打开浏览器
        try {
            await openUrl(link.href)
        } catch (err) {
            console.error('Failed to open link:', err)
        }
    }
}

const renderedHtml = computed(() => md.render(props.data.content || ''))

//#endregion

// #region === 2. 编辑模式逻辑 (CodeMirror) ===
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
    // 如果超过 20 字，进入编辑模式后光标位于末尾
    let selectionRange = { anchor: 0, head: initialContent.length }
    if (initialContent.length > 20) {
        selectionRange.anchor = initialContent.length
    }
    const state = EditorState.create({
        doc: initialContent,
        selection: selectionRange,
        extensions: [
            baseTheme,
            markdownHighlighting,
            history(),
            keymap.of([indentWithTab, ...filteredDefaultKeymap, ...historyKeymap]),
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            EditorView.lineWrapping, // 自动换行
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
//#endregion

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

//#region 事件冒泡

function onKeyDownCapture(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('blur')
    }
    // 仅在自动大小模式下拦截 Tab 和 Enter
    if (!props.fixedSize) {
        if (e.key === 'Tab' || e.key === 'Enter') {
            if (e.key === 'Enter' && e.shiftKey) return
            // 1. 阻止 CodeMirror 接收此事件 (防止缩进/换行)
            e.stopPropagation()
            // 2. 阻止浏览器默认行为 (防止焦点切换)
            e.preventDefault()
            // 3. 通知父组件办事
            emit('command', e.key)
        }
    } else {
        if (e.key === 'Enter' && e.ctrlKey) {
            emit('blur')
        }
    }
    // 其他按键（如打字）放行给 CodeMirror
}

// 除非需要滚动，否则不拦截滚轮事件（允许滚轮缩放）
function onWheel(e: WheelEvent) {
    // 1. 找到真正滚动的容器 (CodeMirror 6 的滚动容器类名是 .cm-scroller)
    // 如果找不到，就找当前组件的根元素
    const scroller = editorRef.value?.querySelector('.cm-scroller') || editorRef.value

    if (scroller) {
        // 允许 1px 的误差 (浏览器缩放时可能有小数)
        const isOverflowing = scroller.scrollHeight > scroller.clientHeight + 1

        // 只有当内容真正溢出需要滚动时，才拦截事件
        if (isOverflowing) {
            e.stopPropagation()
        }
        // 否则：放行事件 -> 冒泡给 Vue Flow -> 触发画布缩放
    }
}

// 允许中键 pan，阻止左键点击
function onMouseDown(e: MouseEvent) {
    if (e.button === 1) {
        // === 中键点击 (Middle Click) ===
        // 1. 阻止默认行为：防止出现浏览器原生滚动图标，防止焦点被抢走导致 blur
        e.preventDefault()

        // 2. 【关键】放行事件冒泡
        // 让 Vue Flow 接收到这个 mousedown，从而启动画布平移 (Pan)
        // 因为我们 preventDefault 了，所以编辑器不会失去焦点

    } else {
        // === 左键点击 (Left Click) ===
        // 拦截冒泡：我们要选中文本，不要让 Vue Flow 以为我们在拖拽节点
        e.stopPropagation()
    }
}

//#endregion
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
        @keyup.stop
        @keydown.capture="onKeyDownCapture"
        @click="onContentClick">
        <div
            v-if="isEditing"
            ref="editorRef"
            class="cm-container"
            @mousedown="onMouseDown"
            @scroll.stop
            @wheel="onWheel"></div>

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
    border-bottom: 1px solid color-mix(in srgb, var(--border-color), transparent 50%);
}

.markdown-body :deep(h2) {
    font-size: var(--md-h2-size);
    font-weight: var(--md-h2-weight);
    color: var(--md-h2-color);
    margin: var(--md-h2-margin);
    line-height: 1.3;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color), transparent 50%);
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
    line-height: var(--md-line-height);
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
    padding: 0 1em;
    background-color: #00000049;
}

/* 代码 */

.markdown-body :deep(code) {
    font-family: var(--md-code-font);
    color: var(--md-code-color);
    border-radius: var(--md-code-radius);
    padding: 0 4px;
}

.markdown-body :deep(code):not(pre code) {
    background-color: var(--md-code-bg);
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
    margin-top: 0.5em;
    margin-bottom: 0.5em;
}


.markdown-body :deep(img) {
    display: block;
    pointer-events: none;

    /* [!code focus:3] 核心修改 */
    /* 限制最大宽高不超过父容器，防止撑破布局 */
    max-width: 100%;
    max-height: 300px;

    /* 配合 object-fit (在 template 的 style 中设置) 使用，
     这能保证图片既不超过容器，又能按需填充(cover)或完整显示(contain) */
}

/* ... 原有样式 ... */

/* === 自定义滚动条样式 === */

/* 1. 定义滚动条的整体尺寸 */
.md-wrapper::-webkit-scrollbar,
:deep(.cm-scroller)::-webkit-scrollbar {
    width: 6px;
    /* 纵向滚动条宽度 */
    height: 6px;
    /* 横向滚动条高度 */
}

/* 2. 定义滚动条轨道 (Track) - 通常设为透明 */
.md-wrapper::-webkit-scrollbar-track,
:deep(.cm-scroller)::-webkit-scrollbar-track {
    background: transparent;
}

/* 3. 定义滑块 (Thumb) - 核心样式 */
.md-wrapper::-webkit-scrollbar-thumb,
:deep(.cm-scroller)::-webkit-scrollbar-thumb {
    /* 使用半透明灰色，这样在深色/浅色模式下都能看清 */
    background-color: rgba(150, 150, 150, 0.3);
    border-radius: 4px;
    /* 圆角 */
}

/* 4. 鼠标悬停在滑块上时加深颜色 */
.md-wrapper::-webkit-scrollbar-thumb:hover,
:deep(.cm-scroller)::-webkit-scrollbar-thumb:hover {
    background-color: rgba(150, 150, 150, 0.6);
}

/* 5. (可选) 只有在鼠标悬停在容器上时才显示滚动条 */
/* 这会让界面更像 Notion，平时极其干净 */
/* .md-wrapper:not(:hover)::-webkit-scrollbar-thumb,
.md-wrapper:not(:hover) :deep(.cm-scroller)::-webkit-scrollbar-thumb {
  background-color: transparent;
} */

/* [!code focus:10] 核心修复 */
:deep(a) {
    /* 1. 强制允许响应鼠标 (关键!) */
    /* 防止父级可能存在的 pointer-events: none 继承下来 */
    pointer-events: auto !important;

    /* 2. 提升层级上下文 */
    /* 防止被同级的 absolute 遮罩层盖住 */
    position: relative;
    z-index: 10;

    /* 3. 鼠标手势 */
    cursor: pointer;
}

/* 确保预览层本身也是可交互的 */
.preview-layer {
    pointer-events: auto;
}


/* [!code focus:50] === Markdown 表格与代码块样式 === */

/* 注意：v-html 生成的内容需要使用 :deep() 选择器 */

/* --- 表格样式 (类似 GitHub 风格) --- */
:deep(table) {
    border-spacing: 0;
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
    overflow: auto;
    /* 防止表格过宽撑破节点 */
    display: block;
    /* 允许横向滚动 */
    overflow: hidden;
}

:deep(th),
:deep(td) {
    padding: 2px 6px;
    border: 1px solid #8f8f8f;
}

:deep(th) {
    font-weight: 600;
    background-color: #ffffff13;
}

:deep(tr) {
    background-color: #00000059;
}

/* --- 代码块样式 --- */
:deep(pre) {
    padding: 12px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    background-color: var(--md-code-bg);
    border-radius: 6px;
    margin: 10px 0;
    font-family: var(--md-code-font) !important;
    /* overflow: hidden; */
    /* 核心修改：强制换行 */
    white-space: pre-wrap;
    /* 保留空格和换行符，但是允许自动换行 */
    word-wrap: break-word;
    /* 在长单词处断行 */
    overflow-wrap: break-word;
    /* 兼容性更好的断行写法 */
}
</style>