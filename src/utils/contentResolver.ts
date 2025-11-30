import type { Component } from 'vue'
import ContentMarkdown from '@/components/contents/ContentMarkdown.vue'
// import ContentImage from '../components/ContentImage.vue'
// import ContentLink from '../components/ContentLink.vue'
import type { LogicNode } from '@/types/model'
import ContentImage from '@/components/contents/ContentImage.vue';
import ContentLink from '@/components/contents/ContentLink.vue';

export function resolveContentComponent(type: string) {
  switch (type) {
    case 'image': return ContentImage;
    case 'link': return ContentLink;
    case 'markdown': 
    default: return ContentMarkdown;
  }
}