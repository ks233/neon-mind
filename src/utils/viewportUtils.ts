import { ViewportTransform } from '@vue-flow/core';

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * 判断节点是否在当前视口内
 * @param nodePos 节点位置 {x, y}
 * @param nodeDim 节点尺寸 {width, height}
 * @param viewport 当前视口状态 {x, y, zoom}
 * @param canvasDim 画布容器尺寸 {width, height} (通常是 window 宽高或 flow 容器宽高)
 * @param buffer 缓冲距离 (px)，预加载用，比如设为 100，即将进入视口时就返回 true
 */
export function isNodeInViewport(
    nodePos: { x: number; y: number },
    nodeDim: { width: number; height: number },
    viewport: ViewportTransform,
    canvasDim: { width: number; height: number },
    buffer = 0
): boolean {
    // 1. 计算视口在"世界坐标系"中的矩形范围
    // 视口 x/y 是负的偏移量，除以 zoom 得到世界坐标
    const viewX = -(viewport.x / viewport.zoom);
    const viewY = -(viewport.y / viewport.zoom);
    const viewW = canvasDim.width / viewport.zoom;
    const viewH = canvasDim.height / viewport.zoom;

    // 2. 加上缓冲区 (扩大视口检测范围)
    const boxX = viewX - buffer;
    const boxY = viewY - buffer;
    const boxW = viewW + buffer * 2;
    const boxH = viewH + buffer * 2;

    // 3. 节点矩形
    const nodeX = nodePos.x;
    const nodeY = nodePos.y;
    const nodeW = nodeDim.width || 0;
    const nodeH = nodeDim.height || 0;

    // 4. AABB 碰撞检测 (两个矩形是否有交集)
    return (
        nodeX < boxX + boxW && // 节点左边 < 视口右边
        nodeX + nodeW > boxX && // 节点右边 > 视口左边
        nodeY < boxY + boxH && // 节点顶边 < 视口底边
        nodeY + nodeH > boxY    // 节点底边 > 视口顶边
    );
}