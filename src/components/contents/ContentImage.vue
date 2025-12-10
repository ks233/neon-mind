<script setup lang="ts">
import { ref } from 'vue'
import type { ImagePayload } from '@/types/model'

// 1. 接收具体类型的 Payload
const props = defineProps<{
    data: ImagePayload
    fixedSize?: boolean
    isEditing: boolean
}>()

const emit = defineEmits<{
    (e: 'update:ratio', ratio: number): void
}>()

const imgRef = ref<HTMLImageElement | null>(null)

// 2. 图片加载完成后计算原始比例
function onImageLoad() {
    if (imgRef.value) {
        const { naturalWidth, naturalHeight } = imgRef.value
        if (naturalHeight > 0) {
            const ratio = naturalWidth / naturalHeight
            // 如果当前比例和记录的不一致，上报更新 (用于 Layout 计算)
            if (Math.abs(ratio - (props.data.ratio || 0)) > 0.01) {
                emit('update:ratio', ratio)
            }
        }
    }
}
</script>

<template>
    <div class="image-content">
        <img
            ref="imgRef"
            :src="data.displaySrc"
            :style="{
                objectFit: data.fit || 'cover',
                // 如果是固定大小，图片填满容器；如果是自动大小，由容器限制
                width: '100%',
                height: '100%'
            }"
            draggable="false"
            @load="onImageLoad" />

        <div v-if="!data.displaySrc" class="image-placeholder">
            No Image
        </div>
    </div>
</template>

<style scoped>
.image-content {
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    /* border-radius: 4px; */
    /*稍微一点圆角*/
}

img {
    display: block;
    pointer-events: none;
    /* 让鼠标事件穿透给父级，方便拖拽节点 */
}
</style>