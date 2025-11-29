import type { LogicNode } from '../types/model';
import type { Node, Edge } from '@vue-flow/core';
import { createVisualNode } from '../utils/transformers';
import { tree, hierarchy } from 'd3-hierarchy';

export { computeMindMapLayout }

async function computeMindMapLayout(rootNode: LogicNode, allNodes: Record<string, LogicNode>) {
    // 配置常量
    const H_GAP = 80; // 水平间距 (Edge Length): 父节点右侧到子节点左侧的距离
    const V_GAP = 20; // 垂直间距 (Sibling Gap): 相邻兄弟节点之间的最小空隙

    // 1. 构建 D3 需要的层级数据结构
    const hierarchyData = hierarchy(rootNode, (d) => {
        return d.childrenIds.map(id => allNodes[id]).filter(Boolean);
    });

    // 2. 配置树状布局
    // nodeSize([height, width]) -> D3 默认 x=垂直, y=水平
    // 这里我们只利用 D3 来计算垂直位置 (Y轴) 的拓扑关系
    const mindMapTree = tree<LogicNode>()
        .nodeSize([1, 1]) // 基础单位设为1，具体距离全靠 separation 控制
        .separation((a, b) => {
            // [核心算法] 动态垂直间距计算
            // 距离 = (A高度的一半 + B高度的一半) + 固定缝隙
            // 这样确保无论节点多高，它们之间永远保留 V_GAP 的空隙，且垂直重心对齐
            const aHeight = a.data.height || 40;
            const bHeight = b.data.height || 40;
            return (aHeight / 2) + (bHeight / 2) + V_GAP;
        });

    // 3. 执行布局计算 (此时 d.x 是垂直中心坐标，d.y 是默认层级坐标)
    const rootD3 = mindMapTree(hierarchyData);

    // 4. [核心修复] 手动计算横向坐标 (X轴)
    // D3 默认假设每一层宽度固定，但这不符合思维导图（节点宽度不一）的需求。
    // 我们手动遍历树，累加计算 X 坐标。
    rootD3.each((d) => {
        if (d.parent) {
            // 这是一个累加过程：
            // 子节点 X = 父节点 X + 父节点实际宽度 + 固定间距
            // 我们把计算出的 visualX 挂载到 d 对象上临时存储
            const parentX = (d.parent as any).visualX || 0;
            
            // 获取父节点宽度，如果没有(比如刚创建)则给默认值 150
            const parentWidth = d.parent.data.width || 150; 
            
            (d as any).visualX = parentX + parentWidth + H_GAP;
        } else {
            // 根节点相对 X 为 0
            (d as any).visualX = 0;
        }
    });

    // 5. 将计算结果转换回 Vue Flow
    const resultNodes: Node[] = [];
    const resultEdges: Edge[] = [];

    // 计算偏移量：保持根节点在世界坐标系中的位置不变
    const startX = rootNode.position?.x || 0;
    const startY = rootNode.position?.y || 0;
    
    // 遍历所有后代节点
    rootD3.descendants().forEach((d) => {
        // [横向修复] 使用手动累加的 visualX
        const relativeX = (d as any).visualX;

        // [纵向修复] 中心点修正 (Center Alignment Fix)
        // d.x 是 D3 算出来的垂直中心线
        // Vue Flow 渲染是以 Top-Left 为锚点
        // 所以: Y = 中心线 - (高度 / 2)
        const nodeHeight = d.data.height || 40;
        const relativeY = d.x - (nodeHeight / 2);

        // 最终坐标 = 根节点世界坐标 + 相对偏移
        const x = startX + relativeX;
        const y = startY + relativeY;

        // 生成节点
        resultNodes.push(createVisualNode(d.data, { x, y }));

        // 生成连线 (Parent -> Child)
        if (d.parent) {
            resultEdges.push({
                id: `e-${d.parent.data.id}-${d.data.id}`,
                source: d.parent.data.id,
                target: d.data.id,
                type: 'smoothstep', 
                animated: false,
                style: { stroke: '#b1b1b7', strokeWidth: 2 },
            });
        }
    });

    return { nodes: resultNodes, edges: resultEdges };
}