// src/utils/grid.ts

import { XYPosition } from "@vue-flow/core";

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

export function ceilToGrid(value: number, gridSize: number = GRID_SIZE): number {
    if (value % gridSize === 0) return value;
    return Math.ceil(value / gridSize) * gridSize;
}

export function snapToGridXY(value: XYPosition, gridSize: number = GRID_SIZE): XYPosition {
    return { x: snapToGrid(value.x), y: snapToGrid(value.y) }
}