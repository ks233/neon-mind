// src/utils/transformers.ts
import type { LogicNode } from '../types/model';
import type { Node, XYPosition } from '@vue-flow/core';

/**
 * 纯函数：将 LogicNode 转换为 Vue Flow Node
 */
export function createVisualNode(logic: LogicNode, computedPos?: XYPosition): Node {
    return {
        id: logic.id,
        // 映射组件类型
        type: logic.type === 'free-note' ? 'markdown' : 'mindmap', 
        
        // 优先使用传入的计算坐标(ELK算出来的)，否则用持久化的坐标，最后兜底 (0,0)
        position: computedPos || logic.position || { x: 0, y: 0 },
        
        // 数据透传
        data: { 
            content: logic.content,
            isRoot: logic.type === 'mind-map-root' 
        },
        
        // 样式尺寸 (如果 model 里存了宽高，应用到 style 上)
        style: logic.width ? { width: `${logic.width}px`, height: `${logic.height}px` } : undefined,
        
        // 只有 group 类型的子节点才需要 parentNode (Vue Flow 原生父子)
        // 思维导图我们是扁平化渲染的，所以是 undefined
        parentNode: logic.type === 'group' ? logic.parentId : undefined, 
    };
}