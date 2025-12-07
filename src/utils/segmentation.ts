// src/utils/segmentation.ts

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

/**
 * 获取一行文本中所有的单词边界位置 (从小到大排序)
 * 例如 "我爱北京": [0, 1, 2, 4]
 */
function getBoundaries(text: string): number[] {
    const segments = segmenter.segment(text);
    const boundaries = new Set<number>([0, text.length]); // 确保首尾一定在里面

    for (const seg of segments) {
        boundaries.add(seg.index);
        boundaries.add(seg.index + seg.segment.length);
    }

    // 转为有序数组
    return Array.from(boundaries).sort((a, b) => a - b);
}

export function findPrevWordBoundary(text: string, currentPos: number): number {
    const boundaries = getBoundaries(text);
    // 倒序查找第一个比 currentPos 小的边界
    for (let i = boundaries.length - 1; i >= 0; i--) {
        if (boundaries[i] < currentPos) {
            return boundaries[i];
        }
    }
    return 0;
}

export function findNextWordBoundary(text: string, currentPos: number): number {
    const boundaries = getBoundaries(text);
    // 正序查找第一个比 currentPos 大的边界
    for (let i = 0; i < boundaries.length; i++) {
        if (boundaries[i] > currentPos) {
            return boundaries[i];
        }
    }
    return text.length;
}

export function getWordRangeAt(text: string, pos: number): { from: number, to: number } | null {
    const segments = segmenter.segment(text);
    for (const seg of segments) {
        const start = seg.index;
        const end = seg.index + seg.segment.length;

        // 如果点击位置在当前分词范围内 (左闭右开区间通常更准，但双击容错要处理右边界)
        if (pos >= start && pos <= end) {
            // 优化：如果是纯标点符号或空格，通常不希望作为"词"选中，而是回退到默认行为
            // if (/^[\s\p{P}]+$/u.test(seg.segment)) return null; 

            return { from: start, to: end };
        }
    }
    return null;
}