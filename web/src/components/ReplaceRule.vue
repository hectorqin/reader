<template>
  <el-dialog
    title="替换规则管理"
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
        :data="$store.state.filterRules"
        :height="dialogContentHeight"
        @selection-change="localSelection = $event"
      >
        <el-table-column type="selection" width="25" fixed> </el-table-column>
        <el-table-column
          property="name"
          min-width="150px"
          label="规则名称"
          fixed
        >
        </el-table-column>
        <el-table-column property="scope" label="替换范围" min-width="150px">
        </el-table-column>
        <el-table-column property="isEnabled" label="是否启用" min-width="80">
          <template slot-scope="scope">
            <el-switch
              v-model="scope.row.isEnabled"
              active-color="#13ce66"
              inactive-color="#ff4949"
              :active-value="true"
              :inactive-value="false"
              @change="toggleRuleEnabled(scope.row, $event)"
            >
            </el-switch>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100px">
          <template slot-scope="scope">
            <el-button type="text" @click="editReplaceRule(scope.row)"
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
        @click="deleteReplaceRules"
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
  name: "ReplaceRule",
  data() {
    return {
      localSelection: []
    };
  },
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"])
  },
  props: ["show"],
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
    async deleteReplaceRules() {
      if (!this.localSelection.length) {
        this.$message.error("请选择需要删除的替换规则");
        return;
      }
      const res = await this.$confirm("确认要删除所选择的替换规则吗?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteReplaceRules", this.localSelection).then(
        res => {
          if (res.data.isSuccess) {
            this.localSelection = [];
            this.$message.success("删除替换规则成功");
            this.$root.$children[0].loadReplaceRules(true);
          }
        },
        error => {
          this.$message.error(
            "删除替换规则失败 " + (error && error.toString())
          );
        }
      );
    },
    toggleRuleEnabled(rule, isEnabled) {
      Axios.post("/saveReplaceRule", { ...rule, isEnabled }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("修改成功");
            this.$root.$children[0].loadReplaceRules(true);
          }
        },
        error => {
          this.$message.error("修改失败 " + (error && error.toString()));
        }
      );
    },
    editReplaceRule(row) {
      eventBus.$emit("showReplaceRuleForm", { ...row }, false);
    }
  }
};
</script>
<style lang="stylus" scoped>
.float-left {
  float: left;
}
</style>
