import { LAYOUT_CONSTANTS, NODE_CONSTANTS } from '@/config/layoutConfig';
import { useCanvasStore } from '@/stores/canvasStore';
import { useUiStore } from '@/stores/uiStore';
import type { LogicNode } from '@/types/model';
import { ceilToGrid, snapToGrid } from '@/utils/grid';
import { createVisualNode } from '@/utils/transformers';
import type { Edge, Node } from '@vue-flow/core';
import potpack from 'potpack';

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
                const estimatedWidth = Math.min(Math.max(
                    NODE_CONSTANTS.MIN_WIDTH,
                    (content.length * NODE_CONSTANTS.CHAR_WIDTH) + NODE_CONSTANTS.PADDING_X
                ), NODE_CONSTANTS.MAX_WIDTH);

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

    const treeRootId = logicRoot.id;

    // 简单的递归遍历收集结果
    function traverse(node: LayoutNode, currentDepth: number) {
        // 现在的 node.x / node.y 已经是相对于根节点的 Top-Left 坐标了
        // 直接加上全局偏移即可，不需要烧脑的中心点换算！
        const finalX = startX + node.x;
        const finalY = ceilToGrid(startY + node.y);

        resultNodes.push(createVisualNode(node.data, { x: finalX, y: finalY }, currentDepth, treeRootId));

        if (node.parent) {
            resultEdges.push({
                id: `em-${node.parent.data.id}-${node.data.id}`,
                source: node.parent.data.id,
                target: node.data.id,
                sourceHandle: 'right',
                targetHandle: 'left',
                type: 'smoothstep',
                animated: false,
                class: node.data.class,
                style: { stroke: 'var(--border-color)', strokeWidth: 3 },
                updatable: false
            });
        }

        node.children.forEach(child => traverse(child, currentDepth + 1));
    }

    traverse(root, 0);

    return { nodes: resultNodes, edges: resultEdges };
}


// ==========================================================
// 辅助算法: 树形几何计算
// ==========================================================

export interface NodeGeometry {
    id: string;
    x: number;      // 绝对世界坐标
    y: number;      // 绝对世界坐标
    width: number;  // 真实渲染宽度
    height: number; // 真实渲染高度
    childrenIds: string[]; // 结构关系 (依然来自 Model)
}

/**
 * 递归计算树的包围盒
 * @param geometryMap 包含了所有节点的【真实】视觉信息
 */
export function getTreeBounds(
    rootId: string,
    geometryMap: Map<string, NodeGeometry> // [!code focus] 改为传入 Map
) {
    const root = geometryMap.get(rootId);
    if (!root) return null;

    let minX = root.x;
    let minY = root.y;
    let maxX = root.x + root.width;
    let maxY = root.y + root.height;

    const memberIds: string[] = [rootId];
    const queue = [...root.childrenIds];

    while (queue.length > 0) {
        const id = queue.shift()!;
        const node = geometryMap.get(id); // [!code focus] 从 Map 获取真实位置
        if (node) {
            memberIds.push(id);

            const nodeRight = node.x + node.width;
            const nodeBottom = node.y + node.height;

            if (node.x < minX) minX = node.x;
            if (node.y < minY) minY = node.y;
            if (nodeRight > maxX) maxX = nodeRight;
            if (nodeBottom > maxY) maxY = nodeBottom;

            if (node.childrenIds) {
                queue.push(...node.childrenIds);
            }
        }
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        memberIds
    };
}

// ==========================================================
// 核心功能: 对齐与打包
// ==========================================================

/**
 * 计算对齐后的坐标
 * @returns 返回一个 Map: { id: { x, y } }
 */
export function calculateAlignLayout(
    targetIds: string[],
    allNodes: Record<string, LogicNode>,
    direction: 'left' | 'right' | 'top' | 'bottom'
) {
    const updates: Record<string, { x: number, y: number }> = {};
    if (targetIds.length < 2) return updates;

    const nodes = targetIds.map(id => allNodes[id]).filter(n => n && !n.parentId); // 过滤掉子节点，防止破坏结构
    if (nodes.length === 0) return updates;

    // 1. 计算对齐锚点 (Anchor)
    let anchor = 0;
    if (direction === 'left') anchor = Math.min(...nodes.map(n => n.x));
    else if (direction === 'right') anchor = Math.max(...nodes.map(n => n.x + (n.width || 0)));
    else if (direction === 'top') anchor = Math.min(...nodes.map(n => n.y));
    else if (direction === 'bottom') anchor = Math.max(...nodes.map(n => n.y + (n.height || 0)));

    // 2. 计算新坐标
    nodes.forEach(node => {
        let newX = node.x;
        let newY = node.y;
        const w = node.width || 0;
        const h = node.height || 0;

        switch (direction) {
            case 'left': newX = anchor; break;
            case 'right': newX = anchor - w; break;
            case 'top': newY = anchor; break;
            case 'bottom': newY = anchor - h; break;
        }

        updates[node.id] = { x: newX, y: newY };
    });

    return updates;
}
/**
 * 计算打包布局
 */
export function calculatePackLayout(
    targetIds: string[],
    geometryMap: Map<string, NodeGeometry> // [!code focus] 输入改为 Geometry Map
) {
    const GAP = 20;
    const updates: Record<string, { x: number, y: number }> = {};

    const boxes = targetIds.map(id => {
        // [!code focus] 传入 geometryMap
        const bounds = getTreeBounds(id, geometryMap);
        if (!bounds) return null;

        return {
            id: id,
            w: bounds.width + GAP,
            h: bounds.height + GAP,
            originalX: bounds.x,
            originalY: bounds.y,
            memberIds: bounds.memberIds
        };
    }).filter(Boolean) as any[];

    if (boxes.length === 0) return updates;

    potpack(boxes);

    // 计算重心偏移
    const oldMinX = Math.min(...boxes.map(b => b.originalX));
    const oldMinY = Math.min(...boxes.map(b => b.originalY));

    boxes.forEach(box => {
        const targetX = oldMinX + box.x;
        const targetY = oldMinY + box.y;
        const dx = targetX - box.originalX;
        const dy = targetY - box.originalY;

        box.memberIds.forEach((memberId: string) => {
            const member = geometryMap.get(memberId);
            if (member) {
                // [!code focus] 返回新的绝对坐标
                updates[memberId] = {
                    x: member.x + dx,
                    y: member.y + dy
                };
            }
        });
    });

    return updates;
}

import { MaxRectsPacker } from 'maxrects-packer';

export function calculateMaxRectsPack(
    targetIds: string[],
    geometryMap: Map<string, NodeGeometry>
) {
    const GAP = 20; // 可配置间距
    const updates: Record<string, { x: number, y: number }> = {};

    // 1. 准备数据
    const inputs = targetIds.map(id => {
        const bounds = getTreeBounds(id, geometryMap);
        if (!bounds) return null;
        return {
            id,
            width: bounds.width,
            height: bounds.height,
            originalX: bounds.x,
            originalY: bounds.y,
            memberIds: bounds.memberIds,
            // MaxRectsPacker 需要的数据结构
            data: { id }
        };
    }).filter(Boolean) as any[];

    if (inputs.length === 0) return updates;

    // 2. 配置 Packer
    // 4096, 4096 是画布预设最大宽高，会自动扩展
    // padding: 间距
    const packer = new MaxRectsPacker(65536, 65536, GAP, {
        smart: true,      // 尝试多种策略寻找最优解
        pot: false,       // 不需要 Power of Two (那是给游戏贴图用的)
        border: GAP       // 画布边缘留白
    });

    // 3. 执行打包
    packer.addArray(inputs);

    // 注意：如果画布太小装不下，packer 会生成多个 bin。
    // 对于无限画布，我们通常只取第一个 bin，或者把 bin 铺开
    // 这里假设所有节点都能装进一个大 bin (因为我们设了 4096+ 且会自动扩容)
    if (packer.bins.length > 0) {
        const bin = packer.bins[0];

        // 4. 计算整体偏移（保持在原地附近）
        const oldMinX = Math.min(...inputs.map(b => b.originalX));
        const oldMinY = Math.min(...inputs.map(b => b.originalY));

        bin.rects.forEach(rect => {
            const box = rect as any; // 类型断言

            const targetX = oldMinX + box.x;
            const targetY = oldMinY + box.y;
            const dx = targetX - box.originalX;
            const dy = targetY - box.originalY;

            // 应用位移到整棵树
            box.memberIds.forEach((memberId: string) => {
                const member = geometryMap.get(memberId);
                if (member) {
                    updates[memberId] = {
                        x: member.x + dx,
                        y: member.y + dy
                    };
                }
            });
        });
    }

    return updates;
}


function isRangeIntersect(min1: number, max1: number, min2: number, max2: number) {
    // 允许一点点容差，防止浮点数精度问题
    return max1 > min2 + 0.1 && min1 < max2 - 0.1;
}

/**
 * 计算紧凑布局 (Gravity Compaction)
 * 类似于 PureRef 的 Ctrl+Arrows：产生一个方向的力，压实空隙，但不改变副轴坐标
 */
export function calculateCompactLayout(
    targetIds: string[],
    geometryMap: Map<string, NodeGeometry>,
    direction: 'left' | 'right' | 'top' | 'bottom'
) {
    const GAP = 20; // 间距
    const updates: Record<string, { x: number, y: number }> = {};

    // 1. 获取包围盒
    const boxes = targetIds.map(id => {
        const bounds = getTreeBounds(id, geometryMap);
        if (!bounds) return null;
        return {
            id,
            x: bounds.x,
            y: bounds.y,
            w: bounds.width,
            h: bounds.height,
            memberIds: bounds.memberIds,
            originalX: bounds.x,
            originalY: bounds.y
        };
    }).filter(Boolean) as any[];

    if (boxes.length < 2) return updates;

    // 2. 预处理：确定边界墙 (Wall)
    const minX = Math.min(...boxes.map(b => b.x));
    const maxX = Math.max(...boxes.map(b => b.x + b.w));
    const minY = Math.min(...boxes.map(b => b.y));
    const maxY = Math.max(...boxes.map(b => b.y + b.h));

    // 3. 排序 (处理顺序很重要)
    if (direction === 'left') {
        boxes.sort((a, b) => a.x - b.x); // 从左到右处理
    } else if (direction === 'right') {
        boxes.sort((a, b) => (b.x + b.w) - (a.x + a.w)); // 从右到左处理
    } else if (direction === 'top') {
        boxes.sort((a, b) => a.y - b.y); // 从上到下处理
    } else if (direction === 'bottom') {
        boxes.sort((a, b) => (b.y + b.h) - (a.y + a.h)); // 从下到上处理
    }

    // 4. 核心算法：带碰撞检测的堆叠
    // processed 数组存放已经安置好的盒子，用来做碰撞检测
    const processed: typeof boxes = [];

    boxes.forEach(current => {
        let targetX = current.x;
        let targetY = current.y;

        if (direction === 'left') {
            // === 向左压 ===
            // 默认目标：最左边的墙
            let limitX = minX;

            // 检查谁挡路了
            processed.forEach(blocker => {
                // 如果 Y 轴有交集 (说明在同一行/高度重叠)
                if (isRangeIntersect(current.y, current.y + current.h, blocker.y, blocker.y + blocker.h)) {
                    // 必须排在 blocker 的右边
                    limitX = Math.max(limitX, blocker.x + blocker.w + GAP);
                }
            });
            targetX = limitX;

        } else if (direction === 'right') {
            // === 向右压 ===
            // 默认目标：最右边的墙 - 自己的宽度
            let limitX = maxX - current.w;

            processed.forEach(blocker => {
                // 如果 Y 轴有交集
                if (isRangeIntersect(current.y, current.y + current.h, blocker.y, blocker.y + blocker.h)) {
                    // 必须排在 blocker 的左边
                    limitX = Math.min(limitX, blocker.x - GAP - current.w);
                }
            });
            targetX = limitX;

        } else if (direction === 'top') {
            // === 向上压 ===
            // 默认目标：最上边的墙
            let limitY = minY;

            processed.forEach(blocker => {
                // 如果 X 轴有交集 (说明在同一列/宽度重叠)
                if (isRangeIntersect(current.x, current.x + current.w, blocker.x, blocker.x + blocker.w)) {
                    // 必须排在 blocker 的下边
                    limitY = Math.max(limitY, blocker.y + blocker.h + GAP);
                }
            });
            targetY = limitY;

        } else if (direction === 'bottom') {
            // === 向下压 ===
            // 默认目标：最下边的墙 - 自己的高度
            let limitY = maxY - current.h;

            processed.forEach(blocker => {
                // 如果 X 轴有交集
                if (isRangeIntersect(current.x, current.x + current.w, blocker.x, blocker.x + blocker.w)) {
                    // 必须排在 blocker 的上边
                    limitY = Math.min(limitY, blocker.y - GAP - current.h);
                }
            });
            targetY = limitY;
        }

        // 更新当前盒子位置，加入已处理列表
        current.x = targetX;
        current.y = targetY;
        processed.push(current);

        // 计算 Delta 并应用到整棵树
        const dx = targetX - current.originalX;
        const dy = targetY - current.originalY;

        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            current.memberIds.forEach((memberId: string) => {
                const member = geometryMap.get(memberId);
                if (member) {
                    updates[memberId] = {
                        x: member.x + dx,
                        y: member.y + dy
                    };
                }
            });
        }
    });

    return updates;
}