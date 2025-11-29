import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { LogicNode, CanvasModel } from '../types/model';
import type { Node, Edge } from '@vue-flow/core';
import { createVisualNode } from '../utils/transformers';

const elk = new ELK();

export { computeMindMapLayout }

async function computeMindMapLayout(rootNode: LogicNode, allNodes: Record<string, LogicNode>) {
    // 1. 准备 ELK 需要的容器 (Graph Container)
    // 我们把整棵思维导图看作一个巨大的 Group，里面的节点都是平级的
    const elkNodes: ElkNode[] = [];
    const elkEdges: any[] = [];

    // 2. 广度优先/递归遍历逻辑树，把它拍平 (Flatten)
    // 我们需要一个队列来遍历 LogicNode 树
    const queue = [rootNode];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const curr = queue.shift()!;
        if (visited.has(curr.id)) continue;
        visited.add(curr.id);

        const nodeWidth = curr.width || Math.max(150, curr.content.length * 8 + 30);
        const nodeHeight = curr.height || 60;

        // A. 添加节点到 ELK 平铺列表
        elkNodes.push({
            id: curr.id,
            width: nodeWidth,
            height: nodeHeight,
        });

        // B. 处理子节点
        if (curr.childrenIds && curr.childrenIds.length > 0) {
            curr.childrenIds.forEach(childId => {
                const childNode = allNodes[childId];
                if (childNode) {
                    // 添加到队列
                    queue.push(childNode);

                    // C. 添加连线关系 (Edge)
                    // 这才是告诉 ELK "谁是谁父亲" 的关键，而不是用 children 嵌套
                    elkEdges.push({
                        id: `e-${curr.id}-${childNode.id}`,
                        sources: [curr.id],
                        targets: [childNode.id]
                    });
                }
            });
        }
    }

    // 3. 构建 ELK Root Graph
    const elkGraph: ElkNode = {
        id: 'root-graph',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.spacing.nodeNode': '30',
            'elk.layered.spacing.nodeNodeBetweenLayers': '100',

            // [!code focus:4] === 核心修正：强制固定顺序 ===
            // 告诉 ELK：请严格尊重我传入的数据顺序，不要自己瞎优化
            'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
            'elk.layered.crossingMinimization.strategy': 'NONE', // 关闭交叉最小化，进一步防止乱序
        },
        children: elkNodes,
        edges: elkEdges
    };

    // 4. 运行算法
    const layoutedGraph = await elk.layout(elkGraph);

    // 5. 将计算结果回填给 VueNodes
    const resultNodes: Node[] = [];
    const resultEdges: Edge[] = [];

    // 获取根节点在 ELK 里的计算位置，用于计算相对偏移
    // 我们希望 Root 节点依然保持在它原来的 World Position
    // 所以我们需要计算一个 "Delta"，把整棵树移过去
    const elkRootNode = layoutedGraph.children?.find(n => n.id === rootNode.id);

    // 偏移量 = (用户设定的 Root 世界坐标) - (ELK 算出来的 Root 相对坐标)
    const offsetX = (rootNode.position?.x || 0) - (elkRootNode?.x || 0);
    const offsetY = (rootNode.position?.y || 0) - (elkRootNode?.y || 0);

    if (layoutedGraph.children) {
        layoutedGraph.children.forEach(elkNode => {
            const logicNode = allNodes[elkNode.id];
            if (!logicNode) return;

            // 应用偏移量，让树跟随后台的 Root Position
            const finalX = (elkNode.x || 0) + offsetX;
            const finalY = (elkNode.y || 0) + offsetY;

            // 生成 Vue Node
            resultNodes.push(createVisualNode(logicNode, { x: finalX, y: finalY }));
        });
    }

    if (layoutedGraph.edges) {
        layoutedGraph.edges.forEach(elkEdge => {
            // 生成 Vue Edge
            // 这里要小心，elkEdge.sources[0] 是节点 ID
            // 但我们需要去原始数据里找 source 和 target
            // 简单点直接用我们生成的 id 解析，或者直接从 elkEdge 对象读
            // ELK edge 结构比较复杂，为了保险，我们直接重新生成一遍简单的连线
            // 或者在这里解析: source = elkEdge.sources[0], target = elkEdge.targets[0]

            // 更简单的做法：直接利用 Logic 数据生成连线，因为连线不需要坐标
            // 只要节点坐标对了，Vue Flow 会自动画线
            // 但如果想用 ELK 的路由点(sections)，则需要解析 sections
            // 现阶段 MVP：让 Vue Flow 自己画线 (type: smoothstep)
            // 只需要确保 edges 列表存在即可
        });
    }

    // 重新遍历一遍 model 生成连线 (比解析 ELK edge 简单)
    // 仅生成树内部的连线
    queue.length = 0;
    queue.push(rootNode);
    visited.clear();

    while (queue.length > 0) {
        const curr = queue.shift()!;
        if (visited.has(curr.id)) continue;
        visited.add(curr.id);

        if (curr.childrenIds) {
            curr.childrenIds.forEach(childId => {
                const childNode = allNodes[childId];
                if (childNode) {
                    queue.push(childNode);
                    resultEdges.push({
                        id: `e-${curr.id}-${childId}`,
                        source: curr.id,
                        target: childId,
                        type: 'smoothstep',
                        animated: false,
                        selectable: false,
                        
                    });
                }
            });
        }
    }

    return { nodes: resultNodes, edges: resultEdges };
}