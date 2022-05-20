<template>
  <el-dialog
    title="用户管理"
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
        >用户管理
        <span class="float-right span-btn" @click="showAddUserDialog()"
          >新增</span
        >
      </span>
    </div>
    <div class="source-container table-container">
      <el-table
        :data="userList"
        :height="dialogContentHeight"
        @selection-change="manageUserSelection = $event"
      >
        <el-table-column
          type="selection"
          width="25"
          :selectable="isUserSelectable"
          fixed
        >
        </el-table-column>
        <el-table-column
          property="username"
          label="用户名"
          min-width="100"
          fixed
        ></el-table-column>
        <el-table-column
          property="lastLoginAt"
          label="上次登录"
          :formatter="formatTableField"
          min-width="120"
        ></el-table-column>
        <el-table-column
          property="createdAt"
          label="注册时间"
          :formatter="formatTableField"
          min-width="120"
        ></el-table-column>
        <el-table-column property="enableWebdav" label="WebDAV" min-width="80">
          <template slot-scope="scope">
            <el-switch
              v-if="scope.row.userNS !== 'default'"
              v-model="scope.row.enableWebdav"
              active-color="#13ce66"
              inactive-color="#ff4949"
              :active-value="true"
              :inactive-value="false"
              @change="toggleUserWebdav(scope.row, $event)"
            >
            </el-switch>
          </template>
        </el-table-column>
        <el-table-column
          property="enableLocalStore"
          label="书仓"
          min-width="80"
        >
          <template slot-scope="scope">
            <el-switch
              v-if="scope.row.userNS !== 'default'"
              v-model="scope.row.enableLocalStore"
              active-color="#13ce66"
              inactive-color="#ff4949"
              :active-value="true"
              :inactive-value="false"
              @change="toggleUserLocalStore(scope.row, $event)"
            >
            </el-switch>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100px">
          <template slot-scope="scope">
            <el-button type="text" @click="resetPassword(scope.row)"
              >重置密码</el-button
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
        @click="deleteUserList"
        >批量删除</el-button
      >
      <span class="check-tip">已选择 {{ manageUserSelection.length }} 个</span>
      <el-button size="medium" @click="cancel">取消</el-button>
    </div>
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";
import Axios from "../plugins/axios";
import eventBus from "../plugins/eventBus";
import { formatSize } from "../plugins/helper";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "UserManage",
  data() {
    return {
      manageUserSelection: []
    };
  },
  props: ["show", "rule", "isAdd"],
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"]),
    userList: {
      get() {
        return this.$store.state.userList;
      },
      set(val) {
        this.$store.commit("setUserList", val);
      }
    }
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        this.manageUserSelection = [];
      }
    }
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    },
    showAddUserDialog() {
      eventBus.$emit("showAddUserDialog");
    },
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
    isUserSelectable(user) {
      return user.userNS !== "default";
    },
    async deleteUserList() {
      if (!this.manageUserSelection.length) {
        this.$message.error("请选择需要删除的用户");
        return;
      }
      const res = await this.$confirm("确认要删除所选择的用户吗?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(
        this.api + "/deleteUsers",
        this.manageUserSelection.map(v => v.username)
      ).then(
        res => {
          if (res.data.isSuccess) {
            this.manageUserSelection = [];
            this.$message.success("删除用户成功");
            this.userList = res.data.data.map(v => ({
              ...v,
              userNS: v.username
            }));
          }
        },
        error => {
          this.$message.error("删除用户失败 " + (error && error.toString()));
        }
      );
    },
    toggleUserWebdav(user, enableWebdav) {
      Axios.post(this.api + "/updateUser", {
        username: user.username,
        enableWebdav
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("修改成功");
            this.userList = res.data.data.map(v => ({
              ...v,
              userNS: v.username
            }));
          }
        },
        error => {
          this.$message.error("修改失败 " + (error && error.toString()));
        }
      );
    },
    toggleUserLocalStore(user, enableLocalStore) {
      Axios.post(this.api + "/updateUser", {
        username: user.username,
        enableLocalStore
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("修改成功");
            this.userList = res.data.data.map(v => ({
              ...v,
              userNS: v.username
            }));
          }
        },
        error => {
          this.$message.error("修改失败 " + (error && error.toString()));
        }
      );
    },
    async resetPassword(user) {
      const res = await this.$prompt("", "重置密码", {
        inputValue: "",
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputValidator(v) {
          if (!v) {
            return "密码不能为空";
          }
          return true;
        }
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/resetPassword", {
        username: user.username,
        password: res.value
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("重置密码成功");
          }
        },
        error => {
          this.$message.error("重置密码失败 " + (error && error.toString()));
        }
      );
    }
  }
};
</script>
<style lang="stylus" scoped>
.float-right {
  float: right;
}
</style>
