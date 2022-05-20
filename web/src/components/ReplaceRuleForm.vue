<template>
  <el-dialog
    title="替换规则"
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
    <el-form :model="ruleForm">
      <el-form-item label="名称">
        <el-input v-model="ruleForm.name"></el-input>
      </el-form-item>
      <el-form-item label="规则">
        <el-input v-model="ruleForm.pattern"></el-input>
      </el-form-item>
      <el-form-item label="替换为">
        <el-input v-model="ruleForm.replacement"></el-input>
      </el-form-item>
      <el-form-item label="替换范围">
        <el-input v-model="ruleForm.scope"></el-input>
      </el-form-item>
      <el-checkbox v-model="ruleForm.isRegex">使用正则表达式</el-checkbox>
      <el-checkbox v-model="ruleForm.isEnabled">是否启用</el-checkbox>
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
import { defaultReplaceRule } from "../plugins/config.js";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "ReplaceRuleForm",
  data() {
    return {
      ruleForm: { ...defaultReplaceRule }
    };
  },
  props: ["show", "rule", "isAdd"],
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"])
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        this.ruleForm = this.rule || { ...defaultReplaceRule };
      }
    }
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    },
    save() {
      if (!this.ruleForm.name) {
        this.$message.error("规则名不能为空");
        return;
      }
      if (!this.ruleForm.pattern) {
        this.$message.error("规则不能为空");
        return;
      }
      if (!this.ruleForm.scope) {
        this.$message.error("替换范围不能为空");
        return;
      }
      if (this.isAdd) {
        // 判断 name 是否唯一
        const isExisted = this.$store.state.filterRules.find(
          v => v.name === this.ruleForm.name
        );
        if (isExisted) {
          this.$message.error("规则名不能重复");
          return;
        }
      }
      const rule = { ...this.ruleForm };
      // this.$store.commit("addFilterRule", rule);
      Axios.post("/saveReplaceRule", rule).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success(
              (this.isAdd ? "新增" : "编辑") + "替换规则成功"
            );
            this.$root.$children[0].loadReplaceRules(true);
            this.cancel();
          }
        },
        error => {
          this.$message.error(
            (this.isAdd ? "新增" : "编辑") +
              "替换规则失败 " +
              (error && error.toString())
          );
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
</style>
