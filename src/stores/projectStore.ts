import { PersistenceManager } from '@/services/persistence/PersistenceManager';
import { dirname, isAbsolute, join, normalize } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useCanvasStore } from './canvasStore';
import { convertFileSrc } from '@tauri-apps/api/core';


export const useProjectStore = defineStore('project', () => {
    const canvasStore = useCanvasStore(); // 在这里引用 canvasStore 获取数据

    // === State: 工程元数据 ===
    const projectFilePath = ref<string | null>(null);
    const projectDir = ref<string | null>(null)
    const isDirty = ref(false); // 是否有未保存的修改
    const isSaving = ref(false); // 是否正在保存中 (用于显示 Loading)
    const isLoading = ref(false);
    const lastSavedAt = ref<Date | null>(null);

    // === Computed: 窗口标题 ===
    const windowTitle = computed(() => {
        let title = 'NeonMind';
        if (projectFilePath.value) {
            title += ` - ${projectFilePath.value}`;
        } else {
            title += ` - Untitled`;
        }
        if (isDirty.value) title += ' ●'; // 常见设计：圆点表示未保存
        return title;
    });

    // === Watcher: 自动更新标题 & 脏检查 ===
    // 监听 canvasStore.model 的变化，一旦变化就标记为 dirty
    // 注意：这里需要深度监听，或者利用 Immer 的 patch 机制触发
    // 如果你在 canvasStore 里实现了 undo/redo，可以在 execute 里手动调用 setDirty()
    watch(windowTitle, (newTitle) => {
        getCurrentWindow().setTitle(newTitle);
    });


    // 监听历史栈长度变化 -> 意味着有操作发生 -> 标记为脏
    watch(() => canvasStore.historyStack.length, (newLen, oldLen) => {
        if (newLen !== oldLen) {
            setDirty(true);
        }
    });

    // === Actions ===

    function setDirty(dirty: boolean) {
        if (isLoading.value) return;
        isDirty.value = dirty;
    }

    async function newProject() {
        // 清空画布
        canvasStore.$reset(); // 需要 canvasStore 支持 reset，或者手动清空
        setProjectFilePath(null)
        console.log('new')
        setDirty(false)
        getCurrentWindow().setTitle(windowTitle.value);
    }

    async function save() {
        console.log('aaa', projectFilePath.value)
        if (!canvasStore.model) return;

        isSaving.value = true;
        try {
            if (projectFilePath.value) {
                // 覆盖保存
                // 这里调用之前的 PersistenceManager，但传入 projectPath
                await PersistenceManager.saveProject(canvasStore.model, projectFilePath.value);
                lastSavedAt.value = new Date();
                setDirty(false)
            } else {
                // 另存为
                await saveAs();
            }
        } finally {
            isSaving.value = false;
        }
    }

    async function saveAs() {
        isSaving.value = true;
        try {
            // saveProjectAs 应该返回用户选择的路径
            const path = await PersistenceManager.saveProjectAs(canvasStore.model);
            if (path) {
                setProjectFilePath(path)
                lastSavedAt.value = new Date();
                setDirty(false)
            }
        } finally {
            isSaving.value = false;
        }
    }

    async function open() {
        const result = await PersistenceManager.openProject();
        if (result) {
            const { model, filePath } = result;
            isLoading.value = true;
            // 加载数据到 CanvasStore
            try {
                canvasStore.loadModel(model);
                // 更新 Project 状态
                setProjectFilePath(filePath)
                lastSavedAt.value = new Date();
                isDirty.value = false // 不用 setDirty
            } finally {
                setTimeout(() => {
                    isLoading.value = false;
                }, 0);
            }
        }
    }
    //#region 文件相关

    // Action: 设置工程路径 (在 PersistenceManager 打开/保存成功后调用)
    async function setProjectFilePath(path: string | null) {
        projectFilePath.value = path;
        if (!path) {
            projectDir.value = null
            return
        }
        projectDir.value = await dirname(path)
    }
    //#endregion


    async function tryGetRelativePath(path: string): Promise<string | null> {
        if (!projectDir.value) {
            return null;
        }
        const normalizedPath = await normalize(path)
        const assetDir = await normalize(projectDir.value)
        if (normalizedPath.startsWith(assetDir)) {
            return normalizedPath.slice(assetDir.length)
        }
        return null
    }

    async function convertThumbSrc(localSrc: string, width: number) {
        let absolutePath = localSrc;

        if (!await isAbsolute(localSrc)) {
            absolutePath = await join(projectDir.value ?? '', localSrc);
        }
        return convertFileSrc(absolutePath, "thumb") + `?w=${width}`;
    }
    return {
        projectFilePath,
        projectDir,
        isDirty,
        isSaving,
        newProject,
        save,
        saveAs,
        open,
        setDirty,
        setProjectFilePath,
        tryGetRelativePath,
        convertThumbSrc
    };
});