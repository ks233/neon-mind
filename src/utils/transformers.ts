// src/utils/transformers.ts
import type { LogicNode } from '../types/model';
import type { Node, XYPosition } from '@vue-flow/core';

/**
 * 纯函数：将 LogicNode 转换为 Vue Flow Node
 */
export function createVisualNode(logic: LogicNode, computedPos?: XYPosition): Node {
    const sizeStyle = logic.fixedSize && logic.width && logic.height
        ? { width: `${logic.width}px`, height: `${logic.height}px` }
        : undefined;

    return {
        id: logic.id,
        type: logic.type === 'free-note' ? 'markdown' : 'mindmap',
        position: computedPos || logic.position || { x: 0, y: 0 },
        data: { 
            content: logic.content,
            isRoot: logic.type === 'mind-map-root',
            fixedSize: logic.fixedSize // 传递标志位给组件
        },
        // [!code focus] 应用修改后的样式逻辑
        style: sizeStyle, 
        parentNode: logic.type === 'group' ? logic.parentId : undefined,
    };
}