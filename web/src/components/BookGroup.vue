<template>
  <el-dialog
    :title="isShowBookGroupSettingDialog ? '设置分组' : '分组管理'"
    :visible.sync="show"
    :width="dialogWidth"
    :top="dialogTop"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    @opened="$refs.bookGroupTableRef.doLayout()"
    v-if="$store.getters.isNormalPage"
    :before-close="cancel"
  >
    <div class="source-container table-container">
      <el-table
        :data="showBookGroupList"
        :height="dialogContentHeight"
        @selection-change="bookGroupSelection = $event"
        ref="bookGroupTableRef"
        :key="isShowBookGroupSettingDialog"
      >
        <el-table-column
          type="selection"
          width="25"
          fixed
          v-if="isShowBookGroupSettingDialog"
        >
        </el-table-column>
        <el-table-column
          property="groupName"
          label="分组名"
          min-width="100"
          fixed
        >
          <template slot-scope="scope">
            <span> {{ displayBookGroupName(scope.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          property="show"
          label="显示"
          min-width="80"
          v-if="!isShowBookGroupSettingDialog"
        >
          <template slot-scope="scope">
            <el-switch
              v-model="scope.row.show"
              active-color="#13ce66"
              inactive-color="#ff4949"
              :active-value="true"
              :inactive-value="false"
              @change="toggleBookGroupShow(scope.row, $event)"
            >
            </el-switch>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100px">
          <template slot-scope="scope">
            <el-button type="text" @click="saveBookGroup(scope.row)"
              >编辑</el-button
            >
            <el-button
              type="text"
              v-if="
                !isShowBookGroupSettingDialog &&
                  scope.row.groupId > 0 &&
                  !getShowShelfBooks(scope.row.groupId).length
              "
              @click="deleteBookGroup(scope.row)"
              style="color: #f56c6c"
              >删除</el-button
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
        @click="saveBookGroup()"
        >添加分组</el-button
      >
      <el-button
        type="primary"
        size="medium"
        @click="setBookGroup"
        v-if="isShowBookGroupSettingDialog"
        >确认</el-button
      >
      <el-button size="medium" @click="cancel">取消</el-button>
    </div>
  </el-dialog>
</template>

<script>
import Axios from "../plugins/axios";
import { mapGetters } from "vuex";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "BookGroup",
  data() {
    return {
      isShowBookGroupSettingDialog: false,
      bookGroupSelection: []
    };
  },
  props: ["show", "isSet"],
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"]),
    showBookGroupList() {
      if (!this.isShowBookGroupSettingDialog) {
        return this.$store.state.bookGroupList;
      }
      return this.$store.state.bookGroupList.filter(v => v.groupId > 0);
    },
    shelfBooks() {
      return this.$store.getters.shelfBooks;
    },
    showBookInfo: {
      get() {
        return this.$store.state.showBookInfo;
      },
      set(val) {
        this.$store.commit("setShowBookInfo", val);
      }
    }
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        this.isShowBookGroupSettingDialog = this.isSet;
        this.bookGroupSelection = [];
        if (this.isSet) {
          this.$nextTick(() => {
            this.$refs.bookGroupTableRef.clearSelection();
            this.getBookGroupListForBook(this.showBookInfo.group).forEach(v => {
              this.$refs.bookGroupTableRef.toggleRowSelection(v, true);
            });
          });
        }
      }
    }
  },
  methods: {
    cancel() {
      this.isShowBookGroupSettingDialog = false;
      this.$emit("setShow", false);
    },
    loadBookGroup(refresh) {
      return this.$root.$children[0].loadBookGroup(refresh);
    },
    getShowShelfBooks(bookGroup) {
      // 处理特殊分组
      if (bookGroup === -1) {
        // 全部
        return this.shelfBooks;
      } else if (bookGroup === -2) {
        // 本地
        return this.shelfBooks.filter(v => v.origin === "loc_book");
      } else if (bookGroup === -3) {
        // 音频
        return this.shelfBooks.filter(v => v.type === 1);
      } else if (bookGroup === -4) {
        // 未分组
        return this.shelfBooks.filter(v => v.group === 0);
      }

      return this.shelfBooks.filter(v =>
        bookGroup === 0 ? true : v.group & bookGroup
      );
    },
    toggleBookGroupShow(bookGroup, show) {
      Axios.post(this.api + "/saveBookGroup", {
        ...bookGroup,
        show
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("修改成功");
            this.loadBookGroup(true);
          }
        },
        error => {
          this.$message.error("修改失败 " + (error && error.toString()));
        }
      );
    },
    async deleteBookGroup(row) {
      const res = await this.$confirm(`确认要删除该分组吗?`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteBookGroup", {
        groupId: row.groupId
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("删除分组成功");
            this.loadBookGroup(true);
          }
        },
        error => {
          this.$message.error("删除分组失败 " + (error && error.toString()));
        }
      );
    },
    async saveBookGroup(bookGroup) {
      const res = await this.$prompt(
        "",
        `${bookGroup ? "编辑分组" : "添加分组"}`,
        {
          inputValue: bookGroup ? bookGroup.groupName : "",
          confirmButtonText: "确定",
          cancelButtonText: "取消",
          inputValidator(v) {
            if (!v) {
              return "分组名不能为空";
            }
            return true;
          }
        }
      ).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/saveBookGroup", {
        ...bookGroup,
        groupName: res.value
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success(bookGroup ? "修改成功" : "添加成功");
            this.loadBookGroup(true);
          }
        },
        error => {
          this.$message.error(
            (bookGroup ? "修改失败" : "添加失败") + (error && error.toString())
          );
        }
      );
    },
    displayBookGroupName(bookGroup) {
      return (
        bookGroup.groupName +
        (bookGroup.groupId < 0
          ? "(" +
            this.$store.getters.builtInBookGroupMap[bookGroup.groupId] +
            ")"
          : "")
      );
    },
    setBookGroup() {
      if (!this.bookGroupSelection.length) {
        this.$message.error("请选择书籍分组");
        return;
      }
      Axios.post(this.api + "/saveBookGroupId", {
        bookUrl: this.showBookInfo.bookUrl,
        groupId: this.bookGroupSelection.reduce((c, v) => {
          return c | v.groupId;
        }, 0)
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("设置成功");
            this.cancel();
            this.showBookInfo = res.data.data;
            this.$store.commit("updateShelfBook", res.data.data);
          }
        },
        error => {
          this.$message.error("设置失败" + (error && error.toString()));
        }
      );
    },
    getBookGroupListForBook(bookGroup) {
      const groups = [];
      this.$store.state.bookGroupList.forEach(v => {
        if (v.groupId > 0 && (v.groupId & bookGroup) !== 0) {
          groups.push(v);
        }
      });
      return groups;
    }
  }
};
</script>
<style lang="stylus" scoped>
.qrcode-img {
  display: block;
  margin: 0 auto;
}
</style>
