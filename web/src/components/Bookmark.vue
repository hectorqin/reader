<template>
  <el-dialog
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
    <div class="custom-dialog-title" slot="title">
      <span class="el-dialog__title"
        >{{ this.book ? this.book.name : "" }} 书签管理
        <span class="float-right span-btn" @click="uploadFile">导入</span>
        <input
          ref="fileRef"
          type="file"
          @change="onFileChange($event)"
          style="display:none"
        />
      </span>
    </div>
    <div class="source-container table-container">
      <el-table
        :data="bookmarkList"
        :height="dialogContentHeight"
        @selection-change="localSelection = $event"
      >
        <el-table-column
          type="selection"
          width="25"
          :fixed="$store.state.miniInterface"
        >
        </el-table-column>
        <el-table-column
          min-width="150px"
          label="书籍"
          :fixed="$store.state.miniInterface"
        >
          <template slot-scope="scope">
            {{ scope.row.bookName }} - {{ scope.row.bookAuthor }}
          </template>
        </el-table-column>
        <el-table-column property="chapterName" label="章节" min-width="150px">
        </el-table-column>
        <el-table-column property="bookText" label="内容" min-width="150px">
        </el-table-column>
        <el-table-column property="content" label="备注" min-width="150px">
        </el-table-column>
        <el-table-column label="操作" width="100px">
          <template slot-scope="scope">
            <el-button type="text" @click="showBookmark(scope.row)"
              >跳转</el-button
            >
            <el-button type="text" @click="editBookmark(scope.row)"
              >编辑</el-button
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
        @click="deleteBookmarks"
        >批量删除</el-button
      >
      <span class="check-tip">已选择 {{ localSelection.length }} 个</span>
      <el-button size="medium" @click="cancel">取消</el-button>
    </div>
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";
import Axios from "../plugins/axios";
import eventBus from "../plugins/eventBus";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "Bookmark",
  data() {
    return {
      localSelection: []
    };
  },
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"]),
    bookmarkList() {
      if (!this.book || !this.book.name) {
        return this.$store.state.bookmarks;
      }
      return this.$store.state.bookmarks.filter(
        v => v.bookName === this.book.name && v.bookAuthor === this.book.author
      );
    }
  },
  props: ["show", "book"],
  watch: {
    show(isVisible) {
      if (isVisible) {
        //
      }
    }
  },
  methods: {
    formatTableField(row, column, cellValue) {
      switch (column.property) {
        default:
          return cellValue;
      }
    },
    cancel() {
      this.$emit("setShow", false);
    },
    async deleteBookmarks() {
      if (!this.localSelection.length) {
        this.$message.error("请选择需要删除的书签");
        return;
      }
      const res = await this.$confirm("确认要删除所选择的书签吗?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteBookmarks", this.localSelection).then(
        res => {
          if (res.data.isSuccess) {
            this.localSelection = [];
            this.$message.success("删除书签成功");
            this.$root.$children[0].loadBookmarks(true);
          }
        },
        error => {
          this.$message.error("删除书签失败 " + (error && error.toString()));
        }
      );
    },
    editBookmark(row) {
      eventBus.$emit("showBookmarkForm", { ...row }, false);
    },
    uploadFile() {
      this.$refs.fileRef.dispatchEvent(new MouseEvent("click"));
    },
    onFileChange(event) {
      const rawFile = event.target.files && event.target.files[0];
      // console.log("rawFile", rawFile);
      const reader = new FileReader();
      reader.onload = e => {
        const data = e.target.result;
        try {
          const bookmarkList = JSON.parse(data);
          if (Array.isArray(bookmarkList) && bookmarkList.length) {
            this.comfirmImport(bookmarkList);
          }
        } catch (error) {
          this.$message.error("书签文件错误");
        }
      };
      reader.onerror = () => {
        // console.log("FileReader error", e);
        // FileReader 读取出错，只能上传读取了
        let param = new FormData();
        param.append("file", rawFile);
        Axios.post(this.api + "/readSourceFile", param, {
          headers: { "Content-Type": "multipart/form-data" }
        }).then(
          res => {
            if (res.data.isSuccess) {
              //
              let bookmarkList = [];
              res.data.data.forEach(v => {
                try {
                  const data = JSON.parse(v);
                  if (Array.isArray(data)) {
                    bookmarkList = bookmarkList.concat(data);
                  }
                } catch (error) {
                  //
                }
              });
              if (bookmarkList.length) {
                this.comfirmImport(bookmarkList);
              } else {
                this.$message.error("书签文件错误");
              }
            }
          },
          error => {
            this.$message.error(
              "读取书签文件内容失败 " + (error && error.toString())
            );
          }
        );
      };
      reader.readAsText(rawFile);
      this.$refs.fileRef.value = null;
    },
    async comfirmImport(bookmarkList) {
      const res = await this.$confirm(
        `确认要导入文件中的${bookmarkList.length}条书签吗?`,
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
      Axios.post(this.api + "/saveBookmarks", bookmarkList).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("导入书签成功");
            this.$root.$children[0].loadBookmarks(true);
          }
        },
        error => {
          this.$message.error("导入书签失败 " + (error && error.toString()));
        }
      );
    },
    showBookmark(bookmark) {
      eventBus.$emit("showBookmark", bookmark);
      this.cancel();
    }
  }
};
</script>
<style lang="stylus" scoped>
.float-left {
  float: left;
}
</style>
