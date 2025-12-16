<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ImagePayload } from '@/types/model'
import { useVueFlow } from '@vue-flow/core';
import { isNodeInViewport } from '@/utils/viewportUtils';
import { getResourceUrl } from '@/utils/imageUtils';

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


// 定义 LOD 等级
const { viewport, dimensions, findNode } = useVueFlow();

const LOD_LEVELS = [300, 600, 1500]
function getLOD(width: number): number {
    const lod = LOD_LEVELS.find(lodWidth => lodWidth >= width);
    return lod ?? 0;
}

const isVisible = ref(false);
const screenPixelWidth = ref(0)
watch(
    () => viewport.value,
    async () => {
        const graphNode = findNode(props.data.id);
        // 如果节点还没初始化好尺寸，先不处理
        if (!graphNode || !graphNode.dimensions || graphNode.dimensions.width === 0) return;

        // 2. 视口剔除 (如果看不见，什么都不加载，或者保留上一帧)
        const inViewport = isNodeInViewport(
            graphNode.computedPosition,
            graphNode.dimensions,
            viewport.value,
            dimensions.value,
            50 // 缓冲区稍微大一点，保证 Medium 加载平滑
        );
        isVisible.value = inViewport;
        if (!inViewport) {
            // 可选：滑出视口后是否销毁？
            // 为了显存考虑，可以只保留 small 级别的 URL，或者置空
            // 这里为了体验，我们不主动销毁，交给浏览器管理
            return;
        }

        // 3. [核心] 计算节点在屏幕上的实际像素宽度
        const nodeWidth = graphNode.dimensions.width;
        const currentZoom = viewport.value.zoom;
        screenPixelWidth.value = nodeWidth * currentZoom;
    },
    { deep: true, immediate: true }
);

const currentSrc = computed(() => {
    let lodWidth = getLOD(screenPixelWidth.value);
    isLOD.value = lodWidth === 0
    // props.data.localSrc 可能是 "_temp/abc.png" 或 "assets/abc.png"
    return getResourceUrl(props.data.runtimePath ?? '', lodWidth);
});

const bgLayerSrc = computed(() => getResourceUrl(props.data.runtimePath ?? props.data.relativePath ?? '', LOD_LEVELS[0]))

// 1. [核心修改] 增加 LOD 状态标记
const isLOD = ref(false)

// 2. [核心修改] 图片加载回调：LOD 模式下不更新数据
function onImageLoad() {
    if (isLOD.value) return;

    if (imgRef.value) {
        const { naturalWidth, naturalHeight } = imgRef.value
        if (naturalHeight > 0) {
            const ratio = naturalWidth / naturalHeight
            if (Math.abs(ratio - (props.data.ratio || 0)) > 0.01) {
                emit('update:ratio', ratio)
            }
        }
    }
}

</script>

<template>
    <div class="image-content image-wrapper">
        <img
            :src="bgLayerSrc"
            class="bg-layer"
            decoding="async" />
        <img
            v-show="isVisible"
            :src="currentSrc"
            class="main-layer nodrag"
            decoding="async"
            @load="onImageLoad" />
        <div v-if="!data.runtimePath" class="image-placeholder">
            No Image
        </div>
        <!-- <div class="debug"> {{ currentSrc }} </div> -->
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

.image-wrapper {
    /* position: relative; */
}

.bg-layer {
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 1;
    /* opacity: 0.2; */
    /* filter: blur(2px); */
    /* 稍微模糊作为背景 */
}

.main-layer {
    position: absolute;
    top: 0;
    left: 0;
    /* top: 0; */
    /* left: 0; */
    width: 100%;
    height: 100%;
    object-fit: contain;
    /* opacity: 0; */
    z-index: 2;
}

.debug {
    position: absolute;
    background-color: black;

    word-wrap: break-word;

    top: 0;
    left: 0;
    width: 100%;
    z-index: 3;
}
</style>