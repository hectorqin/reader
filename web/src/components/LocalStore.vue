<template>
  <el-dialog
    title="书仓文件管理"
    :visible.sync="show"
    :width="dialogWidth"
    :top="dialogTop"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    v-if="$store.getters.isNormalPage"
    :before-close="cancel"
  >
    <div class="source-container table-container">
      <el-table
        :data="localFileList"
        :height="dialogContentHeight"
        @selection-change="localFileSelection = $event"
      >
        <el-table-column
          type="selection"
          width="25"
          fixed
          :selectable="row => !row.toParent"
        >
        </el-table-column>
        <el-table-column property="name" min-width="150px" label="文件名" fixed>
          <template slot-scope="scope">
            <span v-if="!scope.row.isDirectory">{{ scope.row.name }}</span>
            <el-link
              type="primary"
              v-if="scope.row.isDirectory"
              @click="showLocalStoreFile(scope.row.path)"
              >{{ scope.row.name }}</el-link
            >
          </template>
        </el-table-column>
        <el-table-column
          property="size"
          label="大小"
          :formatter="formatTableField"
          min-width="100px"
        ></el-table-column>
        <el-table-column
          property="lastModified"
          label="修改时间"
          :formatter="formatTableField"
          width="120px"
        ></el-table-column>
        <el-table-column label="操作" width="100px">
          <template slot-scope="scope">
            <el-button
              type="text"
              @click="deleteLocalStoreFile(scope.row)"
              style="color: #f56c6c"
              v-if="!scope.row.toParent"
              >删除</el-button
            >
            <el-button
              type="text"
              @click="importFromLocalStore(scope.row)"
              v-if="canImport(scope.row)"
              >加入书架</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div slot="footer" class="dialog-footer">
      <el-button
        type="primary"
        size="medium"
        class="float-left"
        @click="deleteLocalStoreFileList"
        >批量删除</el-button
      >
      <el-button
        type="primary"
        size="medium"
        class="float-left"
        @click="importFromLocalStore(true)"
        >批量加入书架</el-button
      >
      <el-button
        type="primary"
        size="medium"
        class="float-left"
        @click="uploadToLocalStore"
      >
        上传书籍
      </el-button>
      <input
        ref="bookRef"
        type="file"
        multiple="multiple"
        @change="onBookFileChange"
        style="display:none"
      />
      <span class="check-tip">已选择 {{ localFileSelection.length }} 个</span>
      <el-button size="medium" @click="cancel">取消</el-button>
    </div>
  </el-dialog>
</template>

<script>
import Axios from "../plugins/axios";
import { formatSize } from "../plugins/helper";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "LocalStore",
  data() {
    return {
      localCurrentPath: "/",
      localFileList: [],

      localFileSelection: []
    };
  },
  props: ["show", "dialogWidth", "dialogTop", "dialogContentHeight"],
  watch: {
    show(isVisible) {
      if (isVisible) {
        this.showLocalStoreFile("/");
      }
    }
  },
  methods: {
    formatTableField(row, column, cellValue) {
      switch (column.property) {
        case "createdAt":
        case "lastLoginAt":
        case "lastModified":
          return cellValue ? new Date(cellValue).format("yy-MM-dd hh:mm") : "";
        case "size":
          return row.isDirectory ? "" : formatSize(cellValue);
        default:
          return cellValue;
      }
    },
    canImport(row) {
      const path = row.path.toLowerCase();
      return (
        path.endsWith(".txt") || path.endsWith(".epub") || path.endsWith(".umd")
      );
    },
    cancel() {
      this.$emit("setShow", false);
    },
    showLocalStoreFile(path) {
      this.localCurrentPath = path || "/";
      Axios.get(this.api + "/getLocalStoreFileList", {
        params: {
          path: this.localCurrentPath
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            res.data.data = res.data.data || [];
            if (this.localCurrentPath !== "/") {
              const paths = this.localCurrentPath.split("/").filter(v => v);
              paths.pop();
              res.data.data.unshift({
                name: "..",
                isDirectory: true,
                toParent: true,
                path: "/" + paths.join("/")
              });
            }
            this.localFileList = res.data.data;
            this.showLocalStoreManageDialog = true;
          }
        },
        error => {
          this.$message.error(
            "加载书仓文件列表失败 " + (error && error.toString())
          );
        }
      );
    },
    async deleteLocalStoreFileList() {
      if (!this.localFileSelection.length) {
        this.$message.error("请选择需要删除的文件");
        return;
      }
      const res = await this.$confirm("确认要删除所选择的文件吗?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteLocalStoreFileList", {
        path: this.localFileSelection.map(v => v.path)
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.localFileSelection = [];
            this.$message.success("删除文件成功");
            this.showLocalStoreFile(this.localCurrentPath);
          }
        },
        error => {
          this.$message.error("删除文件失败 " + (error && error.toString()));
        }
      );
    },
    async deleteLocalStoreFile(row) {
      const res = await this.$confirm(
        `确认要删除该${row.isDirectory ? "文件夹" : "文件"}吗?`,
        "提示",
        {
          confirmButtonText: "确定",
          cancelButtonText: "取消",
          type: "warning"
        }
      ).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteLocalStoreFile", {
        path: row.path
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("删除文件成功");
            this.showLocalStoreFile(this.localCurrentPath);
          }
        },
        error => {
          this.$message.error("删除文件失败 " + (error && error.toString()));
        }
      );
    },
    async importFromLocalStore(row) {
      if (row === true) {
        if (!this.localFileSelection.length) {
          this.$message.error("请选择需要加入书架的书籍");
          return;
        }
      }
      Axios.post(this.api + "/importFromLocalStorePreview", {
        path:
          row === true ? this.localFileSelection.map(v => v.path) : [row.path]
      }).then(
        res => {
          if (res.data.isSuccess) {
            if (!res.data.data || !res.data.data.length) {
              this.$message.error("没有选择可导入的书籍");
              return;
            }
            // this.cancel();
            setTimeout(() => {
              this.$emit("importFromLocalStorePreview", res.data.data);
            }, 0);
          }
        },
        error => {
          this.$message.error("请求失败 " + (error && error.toString()));
        }
      );
    },
    uploadToLocalStore() {
      this.$refs.bookRef.dispatchEvent(new MouseEvent("click"));
    },
    onBookFileChange(event) {
      if (!event.target || !event.target.files || !event.target.files.length) {
        return;
      }
      let param = new FormData();
      for (let i = 0; i < event.target.files.length; i++) {
        const file = event.target.files[i];
        param.append("file" + i, file);
      }
      param.append("path", this.localCurrentPath);
      Axios.post(this.api + "/uploadFileToLocalStore", param, {
        headers: { "Content-Type": "multipart/form-data" }
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("上传书籍成功");
            this.showLocalStoreFile(this.localCurrentPath);
          }
        },
        error => {
          this.$message.error("上传书籍 " + (error && error.toString()));
        }
      );
      this.$refs.bookRef.value = null;
    }
  }
};
</script>
<style lang="stylus" scoped>
.float-left {
  float: left;
}
</style>
