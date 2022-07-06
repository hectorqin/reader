<template>
  <el-dialog
    title="书签"
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
    <el-form :model="bookmarkForm">
      <el-form-item label="书名">
        <el-input v-model="bookmarkForm.bookName" readonly></el-input>
      </el-form-item>
      <el-form-item label="作者">
        <el-input v-model="bookmarkForm.bookAuthor" readonly></el-input>
      </el-form-item>
      <el-form-item label="章节">
        <el-input v-model="bookmarkForm.chapterName" readonly></el-input>
      </el-form-item>
      <el-form-item label="内容">
        <el-input
          v-model="bookmarkForm.bookText"
          type="textarea"
          :rows="5"
          readonly
        ></el-input>
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="bookmarkForm.content"
          type="textarea"
          :rows="3"
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
import { defaultBookmark } from "../plugins/config.js";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "BookmarkForm",
  data() {
    return {
      bookmarkForm: { ...defaultBookmark }
    };
  },
  props: ["show", "bookmark", "isAdd"],
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"])
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        this.bookmarkForm = this.bookmark || { ...defaultBookmark };
      }
    }
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    },
    save() {
      if (!this.bookmarkForm.bookName && !this.bookmarkForm.bookAuthor) {
        this.$message.error("书籍信息错误");
        return;
      }
      if (!this.bookmarkForm.bookText) {
        this.$message.error("书籍内容不能为空");
        return;
      }
      const form = { ...this.bookmarkForm };
      Axios.post("/saveBookmark", form).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success((this.isAdd ? "新增" : "编辑") + "书签成功");
            this.$root.$children[0].loadBookmarks(true);
            this.cancel();
          }
        },
        error => {
          this.$message.error(
            (this.isAdd ? "新增" : "编辑") +
              "书签失败 " +
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
