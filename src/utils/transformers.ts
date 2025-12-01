// src/utils/transformers.ts
import type { LogicNode } from '@/types/model';
import type { Node, XYPosition} from '@vue-flow/core';

/**
 * 纯函数：将 LogicNode 转换为 Vue Flow Node
 */
export function createVisualNode(logic: LogicNode, computedPos?: XYPosition): Node {
    const sizeStyle = logic.fixedSize && logic.width && logic.height
        ? { width: `${logic.width}px`, height: `${logic.height}px` }
        : undefined;

    return {
        id: logic.id,
        type: 'Universal',
        position: computedPos || { x: logic.x, y: logic.y },
        data: {
            isRoot: logic.structure === 'root',
            fixedSize: logic.fixedSize || false, // 传递标志位给组件
            logicNode: logic
        },
        // [!code focus] 应用修改后的样式逻辑
        style: sizeStyle,
    };
}