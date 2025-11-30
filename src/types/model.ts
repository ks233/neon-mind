// src/types/model.ts

// 维度一：结构角色 (Layout Engine 使用)
// 决定了节点在画布上的行为：是否触发自动排版？是否跟随父节点？
export type StructuralType = 
  | 'root'   // 思维导图根节点 (ELK 布局起点)
  | 'node'   // 普通节点 (可以是导图子节点，也可以是游离节点，取决于有没有 parentId)
  | 'group'; // 分组容器

// 维度二：内容类型 (Renderer 使用)
// 决定了 UniversalNode 内部挂载哪个子组件
export type ContentType = 
  | 'markdown' // 文本/编辑器
  | 'image'    // 图片/PureRef
  | 'link';    // 网页卡片

// 数据载荷 (Payload) - 使用联合类型保证类型安全
interface BaseNode {
  id: string;
  structure: StructuralType; // [重命名] 原来的 type 改为 structure
  contentType: ContentType;  // [新增]
  
  // 通用布局数据
  x: number;
  y: number;
  width?: number;
  height?: number;
  fixedSize?: boolean;
  
  parentId?: string;
  childrenIds: string[];
}

// 具体的内容数据接口
export interface MarkdownPayload extends BaseNode {
  contentType: 'markdown';
  content: string;
}

export interface ImagePayload extends BaseNode {
  contentType: 'image';
  src: string;
  ratio: number; // 宽高比
  fit?: 'cover' | 'contain';
}

export interface LinkPayload extends BaseNode {
  contentType: 'link';
  url: string;
  metaTitle?: string;
  metaDescription?: string;
  metaImage?: string;
}

// [最终类型]
export type LogicNode = MarkdownPayload | ImagePayload | LinkPayload;

export interface LogicEdge {
  id: string;
  source: string;
  target: string;

  sourceHandle?: string; 
  targetHandle?: string;
}

export interface CanvasModel {
  rootNodes: Set<string>; // 顶层入口
  nodes: Record<string, LogicNode>; // 实体池
  edges: LogicEdge[]; // 游离连线 (非导图层级线)
}