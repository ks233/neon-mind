import type { Component } from 'vue'
import ContentMarkdown from '@/components/contents/ContentMarkdown.vue'
// import ContentImage from '../components/ContentImage.vue'
// import ContentLink from '../components/ContentLink.vue'
import type { LogicNode } from '@/types/model'

export function resolveContentComponent(data: LogicNode['data']): Component {
    return ContentMarkdown

    // // 1. 优先判断是否是链接卡片
    // if (data.url && data.metaTitle) {
    //     return ContentLink
    // }

    // // 2. 判断是否有图片
    // if (data.imageUrl) {
    //     return ContentImage
    // }

    // // 3. 默认回退到 Markdown 编辑器
    // return ContentMarkdown
}