import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Annotation } from '@codemirror/state';

// === 1. 基础工具 ===
const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
const LATIN_REGEX = /[a-zA-Z0-9]/;

function isCJK(char: string) { return CJK_REGEX.test(char); }
function isLatin(char: string) { return LATIN_REGEX.test(char); }

function processText(text: string): string {
    if (!text) return text;
    return text
        .replace(/([\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af])([a-zA-Z0-9])/g, '$1 $2')
        .replace(/([a-zA-Z0-9])([\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af])/g, '$1 $2');
}

// 标记：防止死循环
const autoSpaceAnnotation = Annotation.define<void>();

// === 2. 共享的核心处理逻辑 ===
// 无论是粘贴触发，还是输入法结束触发，最终都走这里
function analyzeAndInsert(view: EditorView, from: number, to: number) {
    // 范围不合法直接退出
    if (from >= to) return;

    const changes: any[] = [];
    const doc = view.state.doc;

    // 1. 获取范围内的文本
    const text = doc.sliceString(from, to);
    if (!text) return;

    // 2. 处理内部 (粘贴长文)
    if (text.length > 1) {
        const processed = processText(text);
        if (processed !== text) {
            changes.push({ from, to, insert: processed });
        }
    }

    // 3. 前边界检查
    const prevChar = from > 0 ? doc.sliceString(from - 1, from) : '';
    const firstChar = doc.sliceString(from, from + 1);

    if (
        (isCJK(prevChar) && isLatin(firstChar)) ||
        (isLatin(prevChar) && isCJK(firstChar))
    ) {
        changes.push({ from: from, to: from, insert: ' ' });
    }

    // 4. 后边界检查
    const lastChar = doc.sliceString(to - 1, to);
    const nextChar = to < doc.length ? doc.sliceString(to, to + 1) : '';

    if (
        (isCJK(lastChar) && isLatin(nextChar)) ||
        (isLatin(lastChar) && isCJK(nextChar))
    ) {
        changes.push({ from: to, to: to, insert: ' ' });
    }

    // 5. 执行修改
    if (changes.length > 0) {
        view.dispatch({
            changes,
            annotations: [autoSpaceAnnotation.of()],
            userEvent: 'input.format'
        });
    }
}

// === 3. 状态管理 (使用 WeakMap 隔离不同编辑器的状态) ===
// 记录每个 EditorView 在输入法开始时的光标位置
const compositionStartMap = new WeakMap<EditorView, number>();


// === 4. 扩展入口 ===
// 组合 UpdateListener (处理粘贴/普通打字) 和 DOMHandlers (处理输入法)
export const autoSpaceExtension = [

    // Part A: 监听 DOM 事件 (专门解决输入法 "无变化" 提交的问题)
    EditorView.domEventHandlers({
        compositionstart(event, view) {
            // 记录输入法开始时的光标位置 (Selection Start)
            const start = view.state.selection.main.from;
            compositionStartMap.set(view, start);
        },
        compositionend(event, view) {
            const start = compositionStartMap.get(view);
            compositionStartMap.delete(view); // 清理状态

            if (start !== undefined) {
                // [关键] 使用 setTimeout 确保 CodeMirror 已经完成了 DOM 到 State 的同步
                // 即使 doc 没有 changed，我们依然强制检查 start 到 end 这段范围
                setTimeout(() => {
                    const end = view.state.selection.main.from;
                    analyzeAndInsert(view, start, end);
                }, 0);
            }
        }
    }),

    // Part B: 监听 ViewUpdate (处理粘贴、删除、普通打字)
    EditorView.updateListener.of((update) => {
        // 1. 防止死循环
        if (update.transactions.some(tr => tr.annotation(autoSpaceAnnotation) !== undefined)) {
            return;
        }

        // 2. 如果正在输入法合成中，完全不管 (交给 Part A 处理)
        if (update.view.composing) return;

        // 3. 只有文档变了才处理 (针对非 IME 场景)
        if (!update.docChanged) return;

        // 4. 筛选用户操作 (粘贴 或 普通打字)
        // 注意：这里不再包含 composition 相关事件，因为 Part A 会接管
        const isUserAction = update.transactions.some(tr =>
            tr.isUserEvent('input.type') || tr.isUserEvent('input.paste')
        );

        if (isUserAction) {
            update.changes.iterChanges((fromA, toA, fromB, toB) => {
                // 使用 queueMicrotask 避免在 update 周期内 dispatch
                queueMicrotask(() => {
                    analyzeAndInsert(update.view, fromB, toB);
                });
            });
        }
    })
];