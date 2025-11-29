<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import MarkdownIt from 'markdown-it'

const props = defineProps<{
  content: string
  fixedSize?: boolean
  isEditing: boolean
}>()

const emit = defineEmits<{
  (e: 'update:content', val: string): void
  (e: 'blur'): void
}>()

const md = new MarkdownIt({ html: true, linkify: true, breaks: true })
const localContent = ref(props.content)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// 监听外部传入的编辑状态，自动聚焦
watch(() => props.isEditing, (val) => {
  if (val) {
    localContent.value = props.content // 重置内容，防止脏数据
    nextTick(() => textareaRef.value?.focus())
  }
})

// 渲染 Markdown
const renderedMarkdown = computed(() => md.render(localContent.value))

function onBlur() {
  emit('blur') // 通知父组件退出编辑模式
  if (localContent.value !== props.content) {
    emit('update:content', localContent.value)
  }
}
</script>

<template>
  <div class="content-wrapper">
    <template v-if="isEditing">
      <div 
        v-if="!fixedSize" 
        class="ghost-text" 
        aria-hidden="true"
      >{{ localContent }}<br/></div>

      <textarea
        ref="textareaRef"
        v-model="localContent"
        class="markdown-editor"
        :class="{ 'absolute-fill': !fixedSize }"
        @blur="onBlur"
        @mousedown.stop
        @keydown.stop
      ></textarea>
    </template>

    <div 
      v-else 
      class="markdown-body"
      v-html="renderedMarkdown"
    ></div>
  </div>
</template>

<style scoped>


/* 编辑器样式 */
.markdown-editor {
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    outline: none;
    resize: none;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
    overflow: hidden;
    color: inherit;
}

/* 幽灵元素样式 (必须与 editor 一致) */
.ghost-text {
    visibility: hidden;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    grid-area: 1 / 1 / 2 / 2;
    /* 占据 Grid 第一格 */
}

/* 自动模式下，Textarea 绝对定位覆盖 Ghost */
.markdown-editor.absolute-fill {
    position: absolute;
    top: 0;
    left: 0;
}

/* Markdown 预览样式 */
.markdown-body {
    font-size: 14px;
    line-height: 1.5;
    word-wrap: break-word;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2) {
    margin: 0.2em 0;
    font-size: 1.2em;
    border-bottom: 1px solid var(--border-color);
}

.markdown-body :deep(p) {
    margin: 0;
}

.markdown-body :deep(ul) {
    padding-left: 20px;
    margin: 0;
}

</style>