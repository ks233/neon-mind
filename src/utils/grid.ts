// src/utils/grid.ts

// 定义全局统一的网格步长，必须与 App.vue 中的 :snap-grid 保持一致
export const GRID_SIZE = 20;

/**
 * 将任意坐标吸附到最近的网格点
 * @param value 原始坐标值
 * @param gridSize 网格大小 (默认 20)
 */
export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
    return Math.round(value / gridSize) * gridSize;
}