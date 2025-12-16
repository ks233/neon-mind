// src/utils/transformers.ts
import type { LogicNode } from '@/types/model';
import type { Node, XYPosition } from '@vue-flow/core';

/**
 * 纯函数：将 LogicNode 转换为 Vue Flow Node
 */
export function createVisualNode(
    logic: LogicNode,
    computedPos?: XYPosition,
    depth?: number,
    rootId?: string
): Node {
    const sizeStyle = logic.fixedSize && logic.width && logic.height
        ? { width: `${logic.width}px`, height: `${logic.height}px` }
        : undefined;

    const newNode = {
        id: logic.id,
        type: 'Universal',
        position: computedPos || { x: logic.x, y: logic.y },
        data: {
            logicNode: logic, // logic node 的所有数据
            // 一些用于控制 CSS 的预计算数据
            isRoot: logic.structure === 'root',
            fixedSize: logic.fixedSize || false, // 传递标志位给组件
            // 计算排版时更新，用于上下左右导航
            depth: depth ?? 0,
            rootId: rootId ?? logic.id,
        },
        // 应用修改后的样式逻辑
        style: sizeStyle,
        class: logic.class ?? 'theme-default'
    };
    return newNode
}