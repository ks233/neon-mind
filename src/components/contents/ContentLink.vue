<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import type { LinkPayload } from '@/types/model'

const props = defineProps<{
    data: LinkPayload
    fixedSize?: boolean
    isEditing: boolean
}>()

const emit = defineEmits<{
    (e: 'update:url', url: string): void
    (e: 'blur'): void
}>()

const localUrl = ref(props.data.url)
const inputRef = ref<HTMLInputElement | null>(null)

// 监听编辑状态
watch(() => props.isEditing, (val) => {
    if (val) {
        localUrl.value = props.data.url
        nextTick(() => inputRef.value?.focus())
    }
})

function onBlur() {
    emit('blur')
    if (localUrl.value !== props.data.url) {
        emit('update:url', localUrl.value)
    }
}

function openLink() {
    console.log('asdfas')
    window.open(props.data.url, '_blank')

}

const faviconUrl = computed(() => {
    if (!props.data.url) return ''
    try {
        // 提取 hostname，防止 url 包含非法字符导致请求失败
        const hostname = new URL(props.data.url).hostname
        return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
    } catch (e) {
        // URL 格式错误时不请求
        return ''
    }
})

const displayHostname = computed(() => {
    if (!props.data.url) return ''
    try {
        return new URL(props.data.url).hostname
    } catch (e) {
        // 如果 URL 格式不合法（比如用户只输入了 "abc"），返回原字符串防崩
        return props.data.url
    }
})
</script>

<template>
    <div class="link-wrapper">

        <div v-if="isEditing" class="url-editor">
            <input
                ref="inputRef"
                v-model="localUrl"
                class="nodrag"
                placeholder="Paste URL here..."
                @blur="onBlur"
                @keydown.enter="onBlur"
                @mousedown.stop />
        </div>

        <div
            v-else
            class="link-card"
            @dblclick.stop="openLink">
            <div v-if="data.metaImage" class="link-cover">
                <img :src="data.metaImage" draggable="false" />
            </div>

            <div class="link-info">
                <div class="link-title">{{ data.metaTitle || data.url }}</div>
                <div v-if="data.metaDescription" class="link-desc">
                    {{ data.metaDescription }}
                </div>

                <div class="link-footer">
                    <img :src="faviconUrl" class="favicon" />
                    <span class="hostname">{{ displayHostname }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.link-wrapper {
    width: 100%;
    height: 100%;
    min-width: 200px;
    /* 卡片最小宽度 */
}

.url-editor input {
    width: 100%;
    padding: 8px;
    background: var(--node-bg);
    border: 1px solid #1890ff;
    color: var(--text-color);
    border-radius: 4px;
}

.link-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--node-bg);
    /* 稍微深一点的背景区分 */
    background-color: rgba(128, 128, 128, 0.05);
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: background 0.2s;
}

.link-card:hover {
    background-color: rgba(128, 128, 128, 0.1);
}

.link-cover {
    height: 120px;
    /* 固定封面高度 */
    overflow: hidden;
    flex-shrink: 0;
}

.link-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.link-info {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
}

.link-title {
    font-weight: 600;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.link-desc {
    font-size: 12px;
    color: #888;
    /* 限制显示两行 */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.link-footer {
    margin-top: auto;
    /* 推到底部 */
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #aaa;
}

.favicon {
    width: 14px;
    height: 14px;
}
</style>