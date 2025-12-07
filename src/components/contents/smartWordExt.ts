// src/nodes/contents/smartWordExt.ts
import { EditorView, KeyBinding, keymap } from '@codemirror/view';
import { EditorSelection, Prec } from '@codemirror/state'; // [!code focus] 引入 Prec
import { findPrevWordBoundary, findNextWordBoundary, getWordRangeAt } from '@/utils/segmentation';

// ... moveBySmartWord 函数保持不变 ...
const moveBySmartWord = (forward: boolean, select: boolean) => (view: EditorView) => {
    // ... (逻辑同上一次回答，不需要变) ...
    // 为了节省篇幅，这里简写，请保留之前的 moveBySmartWord 实现
    const { state } = view;
    const doc = state.doc;
    const newSelection = state.selection.ranges.map(range => {
        const line = doc.lineAt(range.head);
        const relPos = range.head - line.from;
        let newRelPos = forward
            ? findNextWordBoundary(line.text, relPos)
            : findPrevWordBoundary(line.text, relPos);
        const newHead = line.from + newRelPos;
        return EditorSelection.range(select ? range.anchor : newHead, newHead);
    });
    view.dispatch({
        selection: EditorSelection.create(newSelection, state.selection.mainIndex),
        scrollIntoView: true,
        userEvent: select ? "select.byWord" : "move.byWord"
    });
    return true;
};

// Keymap 定义
const myKeymap: KeyBinding[] = [
    { key: 'Ctrl-ArrowLeft', run: moveBySmartWord(false, false), shift: moveBySmartWord(false, true) },
    { key: 'Ctrl-ArrowRight', run: moveBySmartWord(true, false), shift: moveBySmartWord(true, true) },
    // 兼容 Mac Cmd
    { key: 'Mod-ArrowLeft', run: moveBySmartWord(false, false), shift: moveBySmartWord(false, true) },
    { key: 'Mod-ArrowRight', run: moveBySmartWord(true, false), shift: moveBySmartWord(true, true) },
];

// Double Click Handler
const myDoubleClick = EditorView.domEventHandlers({
    dblclick(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return;

        const line = view.state.doc.lineAt(pos);
        const relPos = pos - line.from;

        const range = getWordRangeAt(line.text, relPos);

        if (range) {
            // [关键修复] 阻止浏览器默认的全选/闪烁
            event.preventDefault();

            view.dispatch({
                selection: { anchor: line.from + range.from, head: line.from + range.to }
            });
            return true;
        }
        return false;
    }
});

// [!code focus:10] 核心：导出时包裹 Prec.highest
// 这告诉 CodeMirror：无论如何，先执行我的逻辑，不要执行默认的 wordGroup 逻辑
export const smartWordExtension = [
    Prec.highest(keymap.of(myKeymap)),
    myDoubleClick
];