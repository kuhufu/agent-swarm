<script setup lang="ts">
import { onMounted, ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import { apiClient } from "../api/client.js";

interface Document {
  id: string;
  title: string;
  source: string;
  createdAt: number;
}

const documents = ref<Document[]>([]);
const loading = ref(false);
const uploadTitle = ref("");
const uploadContent = ref("");

onMounted(() => loadDocuments());

async function loadDocuments() {
  loading.value = true;
  try {
    const resp = await apiClient<{ data: Document[] }>("/documents");
    documents.value = resp.data;
  } finally {
    loading.value = false;
  }
}

async function handleUpload() {
  if (!uploadTitle.value.trim() || !uploadContent.value.trim()) {
    await MessagePlugin.warning("请填写文档标题和内容");
    return;
  }
  loading.value = true;
  try {
    await apiClient("/documents/upload", {
      method: "POST",
      body: JSON.stringify({ filename: uploadTitle.value.trim(), content: uploadContent.value }),
    });
    await MessagePlugin.success("文档已上传");
    uploadTitle.value = "";
    uploadContent.value = "";
    await loadDocuments();
  } catch (err: any) {
    await MessagePlugin.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function handleDelete(id: string) {
  try {
    await apiClient(`/documents/${id}`, { method: "DELETE" });
    await MessagePlugin.success("文档已删除");
    await loadDocuments();
  } catch (err: any) {
    await MessagePlugin.error(err.message);
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN");
}
</script>

<template>
  <div class="page-container">
    <h1 class="section-title">知识库</h1>

    <!-- Upload form -->
    <div class="card upload-card">
      <h3 class="card-title">上传文档</h3>
      <div class="form-field">
        <input v-model="uploadTitle" class="input-field" placeholder="文档标题" :disabled="loading" />
      </div>
      <div class="form-field">
        <textarea
          v-model="uploadContent"
          class="input-field content-area"
          placeholder="文档内容（支持纯文本和 Markdown）"
          :disabled="loading"
          rows="6"
        ></textarea>
      </div>
      <button class="btn-primary" :disabled="loading" @click="handleUpload">
        {{ loading ? "上传中..." : "上传" }}
      </button>
    </div>

    <!-- Document list -->
    <div class="card" v-if="!loading || documents.length > 0">
      <h3 class="card-title">文档列表</h3>
      <div v-if="!documents.length" class="empty-state">
        <p>暂无文档</p>
      </div>
      <div v-else class="doc-list">
        <div v-for="doc in documents" :key="doc.id" class="doc-item">
          <div class="doc-info">
            <div class="doc-title">{{ doc.title }}</div>
            <div class="doc-meta">{{ doc.source }} · {{ formatDate(doc.createdAt) }}</div>
          </div>
          <button class="btn-danger btn-sm" @click="handleDelete(doc.id)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-card {
  padding: 20px;
  margin-bottom: 20px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 14px;
}

.form-field {
  margin-bottom: 12px;
}

.form-field .input-field {
  width: 100%;
  box-sizing: border-box;
}

.content-area {
  resize: vertical;
  font-family: var(--font-mono);
  font-size: 13px;
}

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.doc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
}

.doc-info {
  min-width: 0;
  flex: 1;
}

.doc-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.doc-meta {
  font-size: 12px;
  color: var(--color-text-muted);
}

.btn-sm {
  padding: 6px 14px;
  font-size: 12px;
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: var(--color-text-muted);
}
</style>
