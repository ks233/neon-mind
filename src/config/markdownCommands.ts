import { EditorView, KeyBinding, keymap } from '@codemirror/view';

/**
 * 通用命令：切换选区周围的 Markdown 标记
 * @param prefix - 标记前缀 (例如 "**")
 * @param suffix - 标记后缀 (例如 "**")
 */
const toggleMarkCommand = (prefix: string, suffix: string) => ({ state, dispatch }: EditorView): boolean => {
    if (!dispatch) return false;

    // 获取当前选区
    const changes: { from: number, to: number, insert: string }[] = [];
    const selection = state.selection.main;
    const { from, to } = selection;

    // 假设未选中任何文本时，在光标位置插入标记
    if (from === to) {
        dispatch(state.update({ changes: { from, to, insert: `${prefix}${suffix}` }, selection: { anchor: from + prefix.length } }));
        return true;
    }

    const selectedText = state.doc.sliceString(from, to);
    const textBefore = state.doc.sliceString(from - prefix.length, from);
    const textAfter = state.doc.sliceString(to, to + suffix.length);

    let newFrom = from;
    let newTo = to;
    let markLength = prefix.length;

    // 1. 检查是否已经包裹 (Toggle Logic)
    if (textBefore === prefix && textAfter === suffix) {
        // 已经包裹 -> 执行移除 (Unwrap)
        changes.push(
            { from: from - prefix.length, to: from, insert: '' }, // 移除前缀
            { from: to, to: to + suffix.length, insert: '' } // 移除后缀 (注意索引变化)
        );
        newFrom = from - prefix.length;
        newTo = to - suffix.length;
    } else {
        // 未包裹 -> 执行包裹 (Wrap)
        changes.push(
            { from, to: from, insert: prefix }, // 插入前缀
            { from: to, to: to, insert: suffix } // 插入后缀
        );
        newFrom = from + prefix.length;
        newTo = to + prefix.length;
    }

    // 创建事务并更新状态
    const transaction = state.update({
        changes,
        selection: { anchor: newFrom, head: newTo },
        scrollIntoView: true,
    });

    dispatch(transaction);
    return true;
};


// 导出常用的 Markdown 快捷键命令
export const toggleBold = toggleMarkCommand('**', '**');
export const toggleItalic = toggleMarkCommand('*', '*'); // 或 '_'
export const toggleStrikethrough = toggleMarkCommand('~~', '~~');
export const toggleInlineCode = toggleMarkCommand('`', '`');


// 定义 CodeMirror Keymap
// 使用 'Mod' 自动适配 Ctrl (Windows/Linux) 或 Cmd (Mac)
export const markdownKeymap: readonly KeyBinding[] = [
    {
        key: 'Mod-b',
        run: toggleBold,
        preventDefault: true,
        // 确保快捷键在输入法激活时也能运行 (可选)
        // mac: 'Mod-b', win: 'Mod-b' 
    },
    {
        key: 'Mod-i',
        run: toggleItalic,
        preventDefault: true
    },
    {
        key: 'Mod-d', // 约定为删除线
        run: toggleStrikethrough,
        preventDefault: true
    },
    {
        key: 'Mod-k', // 约定为行内代码
        run: toggleInlineCode,
        preventDefault: true
    },
    // 你可以继续添加其他命令，例如 Mod-Shift-8 (无序列表)
];

// 将 keymap 包装成 CodeMirror Extension 供外部导入
export const markdownKeymapExtension = keymap.of(markdownKeymap);