<template>
  <el-dialog
    title="新增用户"
    :visible.sync="show"
    :width="dialogSmallWidth"
    :top="dialogTop"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    v-if="$store.getters.isNormalPage"
    :before-close="cancel"
  >
    <el-form :model="addUserForm">
      <el-form-item label="用户名">
        <el-input v-model="addUserForm.username" autocomplete="on"></el-input>
      </el-form-item>
      <el-form-item label="密码">
        <el-input
          type="password"
          v-model="addUserForm.password"
          autocomplete="on"
          show-password
          @keyup.enter.native="login"
        ></el-input>
      </el-form-item>
    </el-form>
    <div slot="footer" class="dialog-footer">
      <el-button size="medium" @click="cancel">取 消</el-button>
      <el-button size="medium" type="primary" @click="save">确 定</el-button>
    </div>
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";
import Axios from "../plugins/axios";

const defaultForm = {
  username: "",
  password: ""
};

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "AddUser",
  data() {
    return {
      addUserForm: { ...defaultForm }
    };
  },
  props: ["show", "rule", "isAdd"],
  computed: {
    ...mapGetters(["dialogSmallWidth", "dialogTop"])
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        this.addUserForm = { ...defaultForm };
      }
    }
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    },
    save() {
      if (!this.addUserForm.username) {
        this.$message.success("用户名不能为空");
        return;
      }
      if (!this.addUserForm.password) {
        this.$message.success("密码不能为空");
        return;
      }
      Axios.post(this.api + "/addUser", this.addUserForm).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("新增成功");
            this.cancel();
            const userList = res.data.data.map(v => ({
              ...v,
              userNS: v.username
            }));
            this.$store.commit("setUserList", userList);
          }
        },
        error => {
          this.$message.error("新增失败 " + (error && error.toString()));
        }
      );
    }
  }
};
</script>
<style lang="stylus" scoped></style>
