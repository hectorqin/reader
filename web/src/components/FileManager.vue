<template>
  <el-dialog
    :title="title"
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
        :data="fileList"
        :height="dialogContentHeight"
        @selection-change="fileSelection = $event"
      >
        <el-table-column
          type="selection"
          width="25"
          :fixed="$store.state.miniInterface"
          :selectable="row => !row.toParent"
        >
        </el-table-column>
        <el-table-column
          property="name"
          min-width="150px"
          label="文件名"
          sortable
          :sort-method="sortMethod"
          :fixed="$store.state.miniInterface"
        >
          <template slot-scope="scope">
            <span v-if="!scope.row.isDirectory">{{ scope.row.name }}</span>
            <el-link
              type="primary"
              v-if="scope.row.isDirectory"
              @click="showFileList(scope.row.path)"
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
            <el-dropdown
              @command="operateFile(scope.row, $event)"
              v-if="!scope.row.isDirectory"
            >
              <el-button class="text-button" type="text" size="medium">
                操作<i class="el-icon-arrow-down el-icon--right"></i>
              </el-button>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item
                  command="downloadFile"
                  v-if="!scope.row.isDirectory"
                  >下载</el-dropdown-item
                >
                <el-dropdown-item
                  command="restoreFromFile"
                  v-if="
                    !scope.row.isDirectory && scope.row.name.endsWith('.zip')
                  "
                  >还原</el-dropdown-item
                >
                <el-dropdown-item
                  command="editFile"
                  v-if="
                    !scope.row.isDirectory && scope.row.name.endsWith('.json')
                  "
                  >编辑</el-dropdown-item
                >
                <el-dropdown-item
                  command="importFromFile"
                  v-if="canImport(scope.row)"
                  >加入书架</el-dropdown-item
                >
              </el-dropdown-menu>
            </el-dropdown>
            <el-button
              type="text"
              @click="deleteFile(scope.row)"
              style="color: #f56c6c"
              v-if="!scope.row.toParent"
              >删除</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div slot="footer" class="dialog-footer">
      <el-dropdown class="float-left" @command="operate">
        <el-button type="primary" size="medium">
          操作<i class="el-icon-arrow-down el-icon--right"></i>
        </el-button>
        <el-dropdown-menu slot="dropdown">
          <el-dropdown-item command="deleteFileList">批量删除</el-dropdown-item>
          <el-dropdown-item command="importFromFile"
            >批量加入书架</el-dropdown-item
          >
          <el-dropdown-item command="mkdir">新建目录</el-dropdown-item>
          <el-dropdown-item command="upload">上传文件</el-dropdown-item>
        </el-dropdown-menu>
      </el-dropdown>
      <input
        ref="bookRef"
        type="file"
        multiple="multiple"
        @change="onFileChange"
        style="display:none"
      />
      <span class="check-tip">已选择 {{ fileSelection.length }} 个</span>
      <el-button size="medium" @click="cancel">取消</el-button>
    </div>
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";
import Axios from "../plugins/axios";
import { formatSize } from "../plugins/helper";
import eventBus from "../plugins/eventBus";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "FileManager",
  data() {
    return {
      currentPath: "/",
      fileList: [],

      fileSelection: []
    };
  },
  props: ["show", "home", "title"],
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"])
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        this.showFileList("/");
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
        path.endsWith(".txt") ||
        path.endsWith(".epub") ||
        path.endsWith(".umd") ||
        path.endsWith(".cbz")
      );
    },
    cancel() {
      this.$emit("setShow", false);
    },
    showFileList(path) {
      this.currentPath = path || "/";
      Axios.get(this.api + "/file/list", {
        params: {
          path: this.currentPath,
          home: this.home
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            res.data.data = res.data.data || [];
            if (this.currentPath !== "/") {
              const paths = this.currentPath.split("/").filter(v => v);
              paths.pop();
              res.data.data.unshift({
                name: "..",
                isDirectory: true,
                toParent: true,
                path: "/" + paths.join("/")
              });
            }
            res.data.data.sort(this.sortMethod);
            this.fileList = res.data.data;
            this.showLocalStoreManageDialog = true;
          }
        },
        error => {
          this.$message.error(
            "加载文件列表失败 " + (error && error.toString())
          );
        }
      );
    },
    sortMethod(a, b) {
      if (a.name === "..") return -1;
      if (b.name === "..") return 1;

      if (a.isDirectory && !b.isDirectory) {
        return -1;
      } else if (!a.isDirectory && b.isDirectory) {
        return 1;
      } else {
        return a.name > b.name ? 1 : -1;
      }
    },
    operate(method) {
      if (method === "importFromFile") {
        return this.importFromFile(true);
      } else {
        this[method].call(this);
      }
    },
    operateFile(file, method) {
      this[method].call(this, file);
    },
    async deleteFileList() {
      if (!this.fileSelection.length) {
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
      Axios.post(this.api + "/file/deleteMulti", {
        path: this.fileSelection.map(v => v.path),
        home: this.home
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.fileSelection = [];
            this.$message.success("删除文件成功");
            this.showFileList(this.currentPath);
          }
        },
        error => {
          this.$message.error("删除文件失败 " + (error && error.toString()));
        }
      );
    },
    async deleteFile(row) {
      const res = await this.$confirm(
        `确认要删除该${row.isDirectory ? "目录" : "文件"}吗?`,
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
      Axios.post(this.api + "/file/delete", {
        path: row.path,
        home: this.home
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("删除成功");
            this.showFileList(this.currentPath);
          }
        },
        error => {
          this.$message.error("删除失败 " + (error && error.toString()));
        }
      );
    },
    async editFile(row) {
      Axios.get(this.api + "/file/get", {
        params: {
          path: row.path,
          home: this.home
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            //
            let content = res.data.data;
            try {
              content = JSON.stringify(JSON.parse(content), null, 4);
            } catch (error) {
              content = res.data.data;
            }
            eventBus.$emit(
              "showEditor",
              "编辑 " + row.name,
              content,
              async (content, close) => {
                try {
                  const res = await this.$confirm(
                    "随意修改内容有可能会造成数据错乱，确认要保存编辑后的内容吗?",
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
                  Axios.post(this.api + "/file/save", {
                    path: row.path,
                    home: this.home,
                    content
                  }).then(
                    res => {
                      if (res.data.isSuccess) {
                        close();
                      }
                    },
                    error => {
                      this.$message.error(
                        "保存文件内容失败 " + (error && error.toString())
                      );
                    }
                  );
                } catch (e) {
                  this.$message.error("内容必须是JSON格式");
                }
              }
            );
          }
        },
        error => {
          this.$message.error(
            "获取文件内容失败 " + (error && error.toString())
          );
        }
      );
    },
    async mkdir() {
      const res = await this.$prompt("", `新建目录`, {
        inputValue: "",
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputValidator(v) {
          if (!v) {
            return "目录名不能为空";
          }
          return true;
        }
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/file/mkdir", {
        path: this.currentPath,
        name: res.value,
        home: this.home
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("操作成功");
            this.showFileList(this.currentPath);
          }
        },
        error => {
          this.$message.error("操作失败" + (error && error.toString()));
        }
      );
    },
    async importFromFile(row) {
      if (row === true) {
        if (!this.fileSelection.length) {
          this.$message.error("请选择需要加入书架的书籍");
          return;
        }
      }
      Axios.post(this.api + "/file/importPreview", {
        path: row === true ? this.fileSelection.map(v => v.path) : [row.path],
        home: this.home
      }).then(
        res => {
          if (res.data.isSuccess) {
            if (!res.data.data || !res.data.data.length) {
              this.$message.error("没有选择可导入的书籍");
              return;
            }
            // this.cancel();
            setTimeout(() => {
              eventBus.$emit("importPreview", res.data.data);
            }, 0);
          }
        },
        error => {
          this.$message.error("请求失败 " + (error && error.toString()));
        }
      );
    },
    upload() {
      this.$refs.bookRef.dispatchEvent(new MouseEvent("click"));
    },
    downloadFile(file) {
      window.open(
        this.api +
          `/file/download?home=${this.home}&path=` +
          escape(file.path) +
          "&accessToken=" +
          this.$store.state.token,
        "__blank"
      );
    },
    onFileChange(event) {
      if (!event.target || !event.target.files || !event.target.files.length) {
        return;
      }
      let param = new FormData();
      for (let i = 0; i < event.target.files.length; i++) {
        const file = event.target.files[i];
        param.append("file" + i, file);
      }
      param.append("home", this.home);
      param.append("path", this.currentPath);
      Axios.post(this.api + "/file/upload", param, {
        headers: { "Content-Type": "multipart/form-data" }
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("上传文件成功");
            this.showFileList(this.currentPath);
          }
        },
        error => {
          this.$message.error("上传文件 " + (error && error.toString()));
        }
      );
      this.$refs.bookRef.value = null;
    },
    async restoreFromFile(row) {
      const res = await this.$confirm(
        `确认要从该压缩文件恢复书源、书架、分组、RSS订阅数据、替换规则、书签、用户配置和Webdav书籍吗?`,
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
      Axios.post(this.api + "/file/restore", {
        path: row.path,
        home: this.home
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("恢复成功");
            this.$root.$children[0].init(true);
          }
        },
        error => {
          this.$message.error("恢复失败 " + (error && error.toString()));
        }
      );
    }
  }
};
</script>
<style lang="stylus" scoped>
.float-left {
  float: left;
}
.source-container {
  .text-button {
    padding: 3px 5px;
  }
}
</style>
