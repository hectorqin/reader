<template>
  <el-dialog
    :visible.sync="show"
    :width="dialogSmallWidth"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    :before-close="cancel"
  >
    <div class="custom-dialog-title" slot="title">
      <span class="el-dialog__title"
        >RSS订阅({{ rssSourceList.length }})
        <span
          class="float-right span-btn"
          @click="showRssSourceEditButton = !showRssSourceEditButton"
          >{{ showRssSourceEditButton ? "取消" : "编辑" }}</span
        >
        <span class="float-right span-btn" @click="uploadRssSource">导入</span>
        <span class="float-right span-btn" @click="editRssSource(false)"
          >新增</span
        >
      </span>
      <input
        ref="rssInputRef"
        type="file"
        @change="onSourceFileChange($event, true)"
        style="display:none"
      />
    </div>
    <div class="rss-source-list-container">
      <div
        class="rss-source"
        v-for="(source, index) in rssSourceList"
        :key="'rss-' + index"
        @click="showRssArticleListDialog(source)"
      >
        <i
          class="el-icon-close"
          v-if="showRssSourceEditButton"
          @click.stop="deleteRssSource(source)"
        ></i>
        <i
          class="el-icon-edit"
          v-if="showRssSourceEditButton"
          @click.stop="editRssSource(source)"
        ></i>
        <el-image
          :src="getImage(source.sourceIcon, true)"
          class="rss-icon"
          fit="cover"
          lazy
        />
        <div class="rss-title">{{ source.sourceName }}</div>
      </div>
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
  name: "RssSourceList",
  data() {
    return {
      showRssSourceEditButton: false
    };
  },
  props: ["show", "rssSource"],
  computed: {
    ...mapGetters(["dialogSmallWidth", "dialogTop"]),
    rssSourceList() {
      return []
        .concat(this.$store.state.rssSourceList)
        .sort((a, b) => a.customOrder - b.customOrder);
    }
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        //
      }
    }
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    },
    async deleteRssSource(source) {
      const res = await this.$confirm(`确认要删除该RSS订阅源吗?`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteRssSource", source).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("删除成功");
            this.loadRssSources(true);
          }
        },
        error => {
          this.$message.error("删除失败 " + (error && error.toString()));
        }
      );
    },
    uploadRssSource() {
      this.$refs.rssInputRef.dispatchEvent(new MouseEvent("click"));
    },
    onSourceFileChange(event, isRssSource) {
      eventBus.$emit("onSourceFileChange", event, isRssSource);
    },
    showRssArticleListDialog(source) {
      eventBus.$emit("showRssArticleListDialog", source);
    },
    editRssSource(rssSource) {
      rssSource = rssSource || {
        sourceName: "新增RSS源",
        sourceUrl: "",
        sourceIcon: "",
        sourceGroup: "",
        enabled: true,
        singleUrl: true,
        articleStyle: 0,
        ruleArticles: "",
        ruleTitle: "",
        rulePubDate: "",
        ruleImage: "",
        ruleLink: "",
        ruleContent: "",
        enableJs: true
      };
      eventBus.$emit(
        "showEditor",
        "编辑RSS源",
        JSON.stringify(rssSource, null, 4),
        (content, close) => {
          try {
            const source = JSON.parse(content);
            if (!source.sourceName) {
              this.$message.error("RSS源名称不能为空");
              return;
            }
            if (!source.sourceUrl) {
              this.$message.error("RSS源链接不能为空");
              return;
            }
            Axios.post(this.api + "/saveRssSource", source).then(
              res => {
                if (res.data.isSuccess) {
                  //
                  close();
                  this.$message.success("保存RSS源成功");
                  this.loadRssSources(true);
                }
              },
              error => {
                this.$message.error(
                  "保存RSS源失败 " + (error && error.toString())
                );
              }
            );
          } catch (e) {
            this.$message.error("RSS源必须是JSON格式");
          }
        }
      );
    },
    loadRssSources(refresh) {
      return this.$root.$children[0].loadRssSources(refresh);
    }
  }
};
</script>
<style lang="stylus" scoped>
.rss-source-list-container {
  max-height: calc(var(--vh, 1vh) * 70 - 54px - 60px);
  overflow-y: auto;

  .rss-source {
    display: inline-block;
    width: 25%;
    box-sizing: border-box;
    padding: 10px;
    position: relative;
    text-align: center;
    vertical-align: top;
    margin-bottom: 10px;
    cursor: pointer;
    position: relative;

    .el-icon-close {
      position: absolute;
      right: 6px;
      top: 8px;
      font-size: 18px;
    }

    .el-icon-edit {
      position: absolute;
      right: 6px;
      top: 42px;
      font-size: 18px;
    }

    .rss-icon {
      display: inline-block;
      width: 50px;
      height: 50px;
      border-radius: 5px;
    }
    .rss-title {
      margin-top: 5px;
      text-align: center;
    }
  }
}
</style>
<style lang="stylus">
.night-theme {
  .rss-source-list-container {
    .rss-source {
      .rss-title {
        color: #aaa;
      }
    }
  }
}
@media screen and (max-width: 750px) {
  .rss-source-list-container {
    max-height: calc(var(--vh, 1vh) * 100 - 54px - 40px) !important;;
  }
}
@media screen and (max-width: 480px) {
  .rss-source-list-container {
    .rss-source {
      .el-icon-close {
        right: -5px;
      }

      .el-icon-edit {
        right: -5px;
      }
    }
  }
}
</style>
