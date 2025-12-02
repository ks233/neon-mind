import type { LogicNode } from '@/types/model';
import type { Node, Edge } from '@vue-flow/core';
import { createVisualNode } from '@/utils/transformers';
import { NODE_CONSTANTS, LAYOUT_CONSTANTS } from '@/config/layoutConfig';
import { ceilToGrid } from '@/utils/grid';

// === 自定义布局节点 ===
// 这是一个临时对象，仅在排版计算期间存在
class LayoutNode {
  data: LogicNode;
  parent?: LayoutNode;
  children: LayoutNode[] = [];

  // 尺寸数据
  width: number = 0;
  height: number = 0;
  areaHeight: number = 0; // 子树占据的总高度

  // 坐标数据 (直接存储相对于父级的 Top-Left 坐标，或者相对根的坐标)
  x: number = 0;
  y: number = 0;

  constructor(data: LogicNode) {
    this.data = data;
  }
}

// src/services/layoutService.ts

export async function computeMindMapLayout(rootNode: LogicNode, allNodes: Record<string, LogicNode>) {
  // 1. 构建树 (Build Tree)
  // 将 LogicNode 转换为带有父子引用的 LayoutNode

  const root = buildLayoutTree(rootNode, allNodes);

  // 2. 测量 (Measure - Post Order)
  // 自底向上计算宽高和包围盒
  measureNodes(root);

  // 3. 布局 (Layout - Pre Order)
  // 自顶向下计算最终 X, Y 坐标
  layoutNodes(root);

  // 4. 生成 (Generate)
  // 转换为 Vue Flow 格式
  return generateElements(root, rootNode);
}

// ==========================================================
// 1. 构建树 (Recursive)
// ==========================================================
function buildLayoutTree(logic: LogicNode, allNodes: Record<string, LogicNode>, parent?: LayoutNode): LayoutNode {
  const node = new LayoutNode(logic);
  node.parent = parent;

  if (logic.childrenIds && logic.childrenIds.length > 0) {
    node.children = logic.childrenIds
      .map(id => allNodes[id])
      .filter(Boolean)
      .map(childLogic => buildLayoutTree(childLogic, allNodes, node));
  }
  
  return node;
}

// ==========================================================
// 2. 测量阶段 (Bottom-Up)
// ==========================================================
function measureNodes(node: LayoutNode) {
// 1. 先递归处理子节点 (Post-Order)
  node.children.forEach(measureNodes);

  const data = node.data;
  let rawWidth = data.width || 0;
  let rawHeight = data.height || 0;

  // 2. 如果没有持久化的尺寸，根据类型进行估算
  if (!rawWidth || !rawHeight) {
    switch (data.contentType) {
      case 'markdown': {
        // [文本策略] 根据字数估算宽度，高度给默认值
        const content = (data as any).content || ''; // 安全访问
        const estimatedWidth = Math.max(
          NODE_CONSTANTS.MIN_WIDTH,
          (content.length * NODE_CONSTANTS.CHAR_WIDTH) + NODE_CONSTANTS.PADDING_X
        );
        
        if (!rawWidth) rawWidth = estimatedWidth;
        if (!rawHeight) rawHeight = NODE_CONSTANTS.MIN_HEIGHT;
        break;
      }

      case 'image': {
        // [图片策略] 宽度给默认值，高度根据比例反算
        const imgData = data as any; // 或者断言为 ImagePayload
        const defaultImageWidth = 200; // 图片默认显示宽度
        
        if (!rawWidth) rawWidth = defaultImageWidth;
        
        // 核心：如果有宽高比，根据宽度算高度
        if (!rawHeight && imgData.ratio) {
          rawHeight = rawWidth / imgData.ratio;
        } else if (!rawHeight) {
          rawHeight = 150; // 兜底高度
        }
        break;
      }

      case 'link': {
        // [链接策略] 固定卡片尺寸
        if (!rawWidth) rawWidth = 300; // 标准网页卡片宽度
        if (!rawHeight) rawHeight = 100; // 标准高度
        break;
      }
      
      default: {
        // 未知类型兜底
        if (!rawWidth) rawWidth = NODE_CONSTANTS.MIN_WIDTH;
        if (!rawHeight) rawHeight = NODE_CONSTANTS.MIN_HEIGHT;
        break;
      }
    }
  }
  // 向上取整吸附网格
  node.width = ceilToGrid(rawWidth);
  node.height = ceilToGrid(rawHeight);

  // B. 计算子树包围盒 (Area Height)
  if (node.children.length === 0) {
    node.areaHeight = node.height;
  } else {
    // 子节点群的总高度
    let childrenTotalHeight = 0;
    node.children.forEach((child, index) => {
      childrenTotalHeight += child.areaHeight;
      if (index < node.children.length - 1) {
        childrenTotalHeight += LAYOUT_CONSTANTS.V_GAP;
      }
    });

    // 核心排版逻辑：取 自身高度 与 子树高度 的最大值
    node.areaHeight = Math.max(node.height, childrenTotalHeight);
  }
}

// ==========================================================
// 3. 布局阶段 (Top-Down)
// ==========================================================
function layoutNodes(node: LayoutNode) {
  // 此时 node.x 和 node.y 已经在父节点的计算中被赋值了 (或者 root 为 0,0)
  
  if (node.children.length > 0) {
    // A. 计算子节点群的起始 X
    // Child X = Parent X + Parent Width + Gap
    const childX = node.x + node.width + LAYOUT_CONSTANTS.H_GAP;

    // B. 计算子节点群的起始 Y
    // 我们要让 "子节点群" 垂直居中于 "当前节点"
    // Center Y = Node Top + Node Height / 2
    const centerY = node.y + (node.height / 2);
    
    // 计算子群总高度 (注意：这里要重新算一遍纯累加高度，不能直接用 max 过的 areaHeight)
    const childrenBlockHeight = node.children.reduce((acc, child, idx) => {
      return acc + child.areaHeight + (idx < node.children.length - 1 ? LAYOUT_CONSTANTS.V_GAP : 0);
    }, 0);

    // Child Start Y = Center Y - (Block Height / 2)
    let currentChildY = centerY - (childrenBlockHeight / 2);

    // C. 遍历赋值
    node.children.forEach(child => {
      child.x = childX;
      
      // 子节点要在自己的 areaHeight 区域内垂直居中
      // 现在的 currentChildY 是 child 的 area 顶部
      // child 自身的顶部 = area 顶部 + (area高度 - 自身高度)/2
      const childOffset = (child.areaHeight - child.height) / 2;
      child.y = currentChildY + childOffset;

      // 递归处理下一层
      layoutNodes(child);

      // 推进 Y 游标
      currentChildY += child.areaHeight + LAYOUT_CONSTANTS.V_GAP;
    });
  }
}

// ==========================================================
// 4. 生成 Vue Flow 元素
// ==========================================================
function generateElements(root: LayoutNode, logicRoot: LogicNode) {
  const resultNodes: Node[] = [];
  const resultEdges: Edge[] = [];

  // 获取全局偏移量
  const startX = logicRoot.x || 0;
  const startY = logicRoot.y || 0;

  // 简单的递归遍历收集结果
  function traverse(node: LayoutNode) {
    // 现在的 node.x / node.y 已经是相对于根节点的 Top-Left 坐标了
    // 直接加上全局偏移即可，不需要烧脑的中心点换算！
    const finalX = startX + node.x;
    const finalY = ceilToGrid(startY + node.y);

    resultNodes.push(createVisualNode(node.data, { x: finalX, y: finalY }));

    if (node.parent) {
      resultEdges.push({
        id: `em-${node.parent.data.id}-${node.data.id}`,
        source: node.parent.data.id,
        target: node.data.id,
        sourceHandle: 'right',
        targetHandle: 'left',
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#177ddc', strokeWidth: 2 },
        updatable: false
      });
    }

    node.children.forEach(traverse);
  }

  traverse(root);

  return { nodes: resultNodes, edges: resultEdges };
}