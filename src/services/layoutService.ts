import type { LogicNode } from '@/types/model';
import type { Node, Edge } from '@vue-flow/core';
import { createVisualNode } from '@/utils/transformers';
import { tree, hierarchy , type HierarchyNode} from 'd3-hierarchy';

// === 类型定义 (让 TS 知道我们在 D3 节点上挂载了什么数据) ===
interface LayoutData extends LogicNode {
  // 这里可以扩展 LogicNode
}

// 扩展 D3 的 HierarchyNode，声明我们计算过程中的临时属性
interface ExtendedNode extends HierarchyNode<LogicNode> {
  areaHeight?: number; // 子树总高度
  layoutX?: number;    // 计算出的相对 X
  layoutY?: number;    // 计算出的相对 Y (垂直中心)
}

// 配置常量
const CONFIG = {
  H_GAP: 80, // 水平间距 (父子之间)
  V_GAP: 20, // 垂直间距 (兄弟之间)
  DEFAULT_W: 150,
  DEFAULT_H: 40
};

// ==========================================================
// 主函数 (Orchestrator)
// ==========================================================
export async function computeMindMapLayout(rootNode: LogicNode, allNodes: Record<string, LogicNode>) {
  
  // 1. 构建层级数据
  const rootD3 = hierarchy(rootNode, (d) => {
    return d.childrenIds.map(id => allNodes[id]).filter(Boolean);
  }) as ExtendedNode;

  // 2. 测量阶段 (自底向上): 计算每个节点撑开的包围盒高度
  measureSubtrees(rootD3);

  // 3. 布局阶段 (自顶向下): 计算具体的 X, Y 坐标
  calculateCoordinates(rootD3);

  // 4. 生成阶段: 转换为 Vue Flow 数据结构
  return generateVueFlowElements(rootD3, rootNode);
}

// ==========================================================
// 子函数 1: 测量子树高度 (Bottom-Up)
// ==========================================================
function measureSubtrees(node: ExtendedNode) {
  // 后序遍历 (Post-Order): 先子后父
  node.eachAfter((d) => {
    const dExt = d as ExtendedNode;
    const myHeight = d.data.height || CONFIG.DEFAULT_H;

    // 如果没有子节点，高度就是自身高度
    if (!d.children || d.children.length === 0) {
      dExt.areaHeight = myHeight;
      return;
    }

    // 如果有子节点，计算所有子节点堆叠起来的高度
    let childrenTotalHeight = 0;
    d.children.forEach((child, index) => {
      const childExt = child as ExtendedNode;
      childrenTotalHeight += (childExt.areaHeight || 0);
      
      // 加上间隙 (除了最后一个)
      if (index < d.children!.length - 1) {
        childrenTotalHeight += CONFIG.V_GAP;
      }
    });

    // 核心逻辑: 取 自身高度 与 子树堆叠高度 的最大值
    // 这样能保证大节点不会被遮挡，大子树也不会重叠
    dExt.areaHeight = Math.max(myHeight, childrenTotalHeight);
  });
}

// ==========================================================
// 子函数 2: 计算坐标 (Top-Down)
// ==========================================================
function calculateCoordinates(root: ExtendedNode) {
  // 初始化根节点
  root.layoutX = 0;
  root.layoutY = 0;

  // 前序遍历 (Pre-Order): 先父后子
  root.eachBefore((d) => {
    const dExt = d as ExtendedNode;

    // A. 计算当前节点的 X (基于父节点累加)
    if (d.parent) {
      const parentExt = d.parent as ExtendedNode;
      const parentWidth = parentExt.data.width || CONFIG.DEFAULT_W;
      
      dExt.layoutX = (parentExt.layoutX || 0) + parentWidth + CONFIG.H_GAP;
    }

    // B. 计算子节点的 Y (垂直居中于父节点)
    if (d.children && d.children.length > 0) {
      const children = d.children as ExtendedNode[];
      
      // 1. 计算纯子节点群的总高度 (不含父节点自身对比，只看子节点列表)
      const childrenContentHeight = children.reduce((acc, child, idx) => {
        const gap = idx < children.length - 1 ? CONFIG.V_GAP : 0;
        return acc + (child.areaHeight || 0) + gap;
      }, 0);

      // 2. 确定子节点群的起始 Y 坐标 (Top)
      // 父节点中心 - 子群高度的一半
      let currentChildY = (dExt.layoutY || 0) - (childrenContentHeight / 2);

      // 3. 逐个放置子节点
      children.forEach((child) => {
        const childArea = child.areaHeight || 0;
        
        // 子节点的中心 Y = 当前起始线 + 子树高度的一半
        child.layoutY = currentChildY + (childArea / 2);
        
        // 推进起始线 (为下一个兄弟留位置)
        currentChildY += childArea + CONFIG.V_GAP;
      });
    }
  });
}

// ==========================================================
// 子函数 3: 生成结果 (Transformation)
// ==========================================================
function generateVueFlowElements(rootD3: ExtendedNode, logicRoot: LogicNode) {
const resultNodes: Node[] = [];
  const resultEdges: Edge[] = [];

  // [锚点数据]
  // startX/Y 是根节点的世界坐标 (Top-Left)
  const startX = logicRoot.position?.x || 0;
  const startY = logicRoot.position?.y || 0;
  
  // 获取根节点的高度 (用于修正中心点偏移)
  // 注意：这里必须和下面 dExt.data.height 获取逻辑一致，优先取 store 里的 height
  const rootHeight = logicRoot.height || CONFIG.DEFAULT_H;

  rootD3.descendants().forEach((d) => {
    const dExt = d as ExtendedNode;

    // 1. 获取布局相对坐标
    // layoutX 是左边缘 (Left), layoutY 是垂直中心 (Center Y)
    const relativeLeft = dExt.layoutX || 0;
    const relativeCenterY = dExt.layoutY || 0;
    
    const nodeHeight = d.data.height || CONFIG.DEFAULT_H;
    
    // 2. [核心修复] 坐标转换公式
    // 我们要确保：当 d 是根节点时(relative=0)，计算结果 = startY
    
    // X 轴直接累加 (因为 layoutX 就是 Left)
    const finalX = startX + relativeLeft;

    // Y 轴转换：
    // 根节点的世界中心 = startY + (rootHeight / 2)
    // 当前节点的世界中心 = 根节点世界中心 + relativeCenterY
    // 当前节点的世界Top  = 当前节点世界中心 - (nodeHeight / 2)
    const finalY = (startY + rootHeight / 2) + relativeCenterY - (nodeHeight / 2);

    // 3. 生成 Vue Node
    resultNodes.push(createVisualNode(d.data, { x: finalX, y: finalY }));

    // 4. 生成 Vue Edge
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