// src/types/model.ts
export type NodeType = 'free-note' | 'mind-map-root' | 'mind-map-node';

export interface LogicNode {
  id: string;
  type: NodeType;
  content: string;
  position?: { x: number, y: number }; // 自由节点和根节点有
  parentId?: string; // 导图子节点有
  childrenIds: string[]; // 树状结构引用
  data?: any; // 扩展数据
  width?: number;
  height?: number;
  fixedSize?: boolean;
}

export interface LogicEdge {
  id: string;
  source: string;
  target: string;
}

export interface CanvasModel {
  rootNodes: string[]; // 顶层入口
  nodes: Record<string, LogicNode>; // 实体池
  edges: LogicEdge[]; // 游离连线 (非导图层级线)
}