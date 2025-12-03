// src/config/layoutConfig.ts

export const NODE_CONSTANTS = {
    // 必须与 MindMapNode.vue 里的 CSS min-width 保持一致
    MIN_WIDTH: 100,
    MAX_WIDTH: 400,
    // 必须与 CSS 的 line-height + padding 计算结果一致
    MIN_HEIGHT: 40,

    // 估算系数：每个中文字符大概占多少像素 (14px字体 * 1.5倍左右)
    CHAR_WIDTH: 14,
    PADDING_X: 24, // 左右 padding 之和 (12px * 2)
};

export const LAYOUT_CONSTANTS = {
    H_GAP: 80, // 水平间距
    V_GAP: 20, // 垂直间距
};