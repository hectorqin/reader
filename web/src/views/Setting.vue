<template>
  <div
    class="setting-wrapper"
    :class="{
      night: isNight,
      day: !isNight
    }"
  >
    <div
      class="navigation-wrapper"
      :class="[
        navigationClass,
        isWebApp && !isNight ? 'status-bar-light-bg' : ''
      ]"
      :style="navigationStyle"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <div class="navigation-inner-wrapper">
        <div class="navigation-title">
          阅读
          <span class="version-text">{{ $store.state.version }}</span>
        </div>
        <div class="navigation-sub-title">
          清风不识字，何故乱翻书
        </div>
      </div>
    </div>
    <div
      class="setting-zone-wrapper"
      :class="isWebApp && !isNight ? 'status-bar-light-bg' : ''"
      ref="shelfWrapper"
      @click="hideMenu"
    >
      <div class="setting-zone-title">
        <i
          class="el-icon-menu"
          v-if="$store.getters.isNormalPage && collapseMenu"
          @click.stop="toggleMenu"
        ></i>
        设置
        <div class="title-btn" @click="backToShelf">
          书架
        </div>
      </div>
      <div class="setting-form-wrapper">
        <el-form
          :model="windowConfigForm"
          :label-width="collapseMenu ? 'auto' : '95px'"
        >
          <el-form-item label="Java路径">
            <el-input v-model="windowConfigForm.javaPath"></el-input>
          </el-form-item>
          <el-form-item label="服务端口">
            <el-input v-model="windowConfigForm.serverPort"></el-input>
          </el-form-item>
          <el-form-item label="服务配置">
            <el-input
              v-model="windowConfigForm.serverConfig"
              type="textarea"
              :rows="5"
            ></el-input>
          </el-form-item>
          <el-form-item label="窗口宽度">
            <el-input v-model="windowConfigForm.width"></el-input>
          </el-form-item>
          <el-form-item label="窗口高度">
            <el-input v-model="windowConfigForm.height"></el-input>
          </el-form-item>
          <el-form-item label="横坐标">
            <el-input v-model="windowConfigForm.positionX"></el-input>
          </el-form-item>
          <el-form-item label="纵坐标">
            <el-input v-model="windowConfigForm.positionY"></el-input>
          </el-form-item>
          <el-form-item label="其他配置">
            <el-checkbox v-model="windowConfigForm.rememberSize"
              >记住窗口大小</el-checkbox
            >
            <el-checkbox v-model="windowConfigForm.setWindowSize"
              >启动时设置窗口大小</el-checkbox
            >
            <el-checkbox v-model="windowConfigForm.rememberPosition"
              >记住窗口位置</el-checkbox
            >
            <el-checkbox v-model="windowConfigForm.setWindowPosition"
              >启动时设置窗口位置</el-checkbox
            >
          </el-form-item>
          <div style="text-align: center;">
            <el-button type="primary" @click="saveConfig">保存并重启</el-button>
          </div>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script>
import { mapGetters } from "vuex";
// import Axios from "../plugins/axios";
// import eventBus from "../plugins/eventBus";
// const buildURL = require("axios/lib/helpers/buildURL");

export default {
  data() {
    return {
      showNavigation: false,

      navigationClass: "",
      navigationStyle: {},

      windowConfigForm: {
        javaPath: "",
        serverPort: 8080,
        width: 1280,
        height: 800,
        rememberSize: true,
        rememberPosition: false,
        setWindowSize: true,
        setWindowPosition: false,
        serverConfig: `{

}`
      }
    };
  },
  created() {
    if (window.__TAURI__ && window.__TAURI__.invoke) {
      window.__TAURI__
        .invoke("get_config")
        .then(config => {
          config.serverConfig = JSON.stringify(config.serverConfig, null, 4);
          this.windowConfigForm = { ...config };
        })
        .catch(() => {});
    }
    window.settingPage = this;
    this.navigationClass =
      this.collapseMenu && !this.showNavigation ? "navigation-hidden" : "";
  },
  computed: {
    ...mapGetters(["isNight", "collapseMenu"])
  },
  methods: {
    handleTouchStart(e) {
      this.lastTouch = false;
      this.lastMoveX = false;
      this.touchMoveTimes = 0;
      // 边缘 20px 以内禁止触摸
      if (
        e.touches &&
        e.touches[0] &&
        e.touches[0].clientX > 20 &&
        e.touches[0].clientX < window.innerWidth - 20 &&
        e.touches[0].clientY > 20 &&
        e.touches[0].clientY < window.innerHeight - 20
      ) {
        this.lastTouch = e.touches[0];
      }
    },
    handleTouchMove(e) {
      if (e.touches && e.touches[0] && this.lastTouch) {
        if (this.collapseMenu) {
          const moveX = e.touches[0].clientX - this.lastTouch.clientX;
          const moveY = e.touches[0].clientY - this.lastTouch.clientY;
          if (Math.abs(moveY) > Math.abs(moveX)) {
            this.navigationStyle = {};
            this.lastMoveX = 0;
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          if (!this.showNavigation && moveX > 0 && moveX <= 270) {
            // 往右拉，打开目录
            if (this.touchMoveTimes % 3 === 0) {
              this.navigationStyle = {
                marginLeft: moveX - 270 + "px"
              };
            }
            this.lastMoveX = moveX;
          } else if (this.showNavigation && moveX < 0 && moveX >= -270) {
            // 往左拉，关闭目录
            if (this.touchMoveTimes % 3 === 0) {
              this.navigationStyle = {
                marginLeft: moveX + "px"
              };
            }
            this.lastMoveX = moveX;
          }
          this.touchMoveTimes++;
        }
      }
    },
    handleTouchEnd() {
      if (this.collapseMenu) {
        if (this.lastMoveX > 0) {
          this.showNavigation = true;
          this.navigationStyle = {};
        } else if (this.lastMoveX < 0) {
          this.showNavigation = false;
          this.navigationStyle = {};
        }
      }
    },
    hideMenu() {
      if (this.$store.getters.isNormalPage && this.collapseMenu) {
        this.showNavigation = false;
      }
    },
    toggleMenu() {
      if (this.collapseMenu) {
        this.showNavigation = !this.showNavigation;
      }
    },
    async backToShelf() {
      if (window.__TAURI__ && window.__TAURI__.invoke) {
        const isJavaAvaliable = await window.__TAURI__
          .invoke("check_java", {
            javaPath: this.windowConfigForm.javaPath || ""
          })
          .catch(err => {
            this.$message.error(
              "未检测到 Java 运行环境，请确认 Java 路径设置是否正确 " + err
            );
            return false;
          });
        if (!isJavaAvaliable) {
          return;
        }
      }
      this.$router.replace("/");
    },
    async saveConfig() {
      const config = { ...this.windowConfigForm };
      try {
        config.serverConfig = JSON.parse(config.serverConfig);
      } catch (error) {
        this.$message.error("服务配置必须是 JSON 格式");
        return;
      }
      if (!window.__TAURI__ || !window.__TAURI__.invoke) {
        this.$message.error("必须使用 Tauri 客户端打开此页面");
        return;
      }
      const isJavaAvaliable = await window.__TAURI__
        .invoke("check_java", { javaPath: config.javaPath || "" })
        .catch(err => {
          this.$message.error(
            "未检测到 Java 运行环境，请确认 Java 路径设置是否正确 " + err
          );
          return false;
        });
      if (!isJavaAvaliable) {
        return;
      }
      const isSaved = await window.__TAURI__
        .invoke("save_config", {
          config
        })
        .catch(err => {
          this.$message.error("配置保存失败" + err);
          return false;
        });
      if (!isSaved) {
        return;
      }
      window.__TAURI__.process.relaunch();
    }
  },
  watch: {
    collapseMenu(val) {
      if (!val) {
        this.navigationClass = "";
      } else if (!this.showNavigation) {
        this.navigationClass = "navigation-hidden";
      }
    },
    showNavigation(val) {
      if (!val) {
        this.navigationClass = "navigation-out";
        setTimeout(() => {
          this.navigationClass = "navigation-hidden";
        }, 300);
      } else {
        this.navigationClass = "navigation-in";
      }
    }
  }
};
</script>

<style lang="stylus" scoped>
.setting-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: row;

  .navigation-wrapper {
    width: 260px;
    min-width: 260px;
    height: 100%;
    box-sizing: border-box;
    background-color: #F7F7F7;
    position: relative;
    padding-top: 0;
    padding-top: constant(safe-area-inset-top) !important;
    padding-top: env(safe-area-inset-top) !important;

    .navigation-inner-wrapper {
      padding: 48px 36px 66px 36px;
      height: 100%;
      overflow-y: auto;
      box-sizing: border-box;
    }

    .navigation-title {
      font-size: 24px;
      font-weight: 600;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;

      .version-text {
        float: right;
        font-size: 14px;
        line-height: 33px;
        font-weight: 400;
        color: #b1b1b1;
        display: inline-block;
        cursor: pointer;
      }
    }

    .navigation-sub-title {
      font-size: 16px;
      font-weight: 500;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
      margin-top: 16px;
      color: #b1b1b1;
    }

    .setting-wrapper {
      margin-top: 36px;

      .setting-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;

        .right-text {
          float: right;
          display: inline-block;
          height: 20px;
          line-height: 20px;
          cursor: pointer;
          user-select: none;
        }
      }

      .no-point {
        pointer-events: none;
      }

      .setting-connect {
        cursor: pointer;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .setting-item {
        padding-top: 16px;
      }

      .setting-btn {
        margin-right: 15px;
        margin-bottom: 15px;
        cursor: pointer;
      }

      .setting-select {
        width: 100%;
      }
    }

    .search-setting {
      margin-top: 28px;
    }

    .bottom-icons {
      position: absolute;
      bottom: 30px;
      width: 188px;
      left: 36px;
      align-items: center;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      pointer-events: none;

      .bottom-icon {
        height: 36px;
        pointer-events: all;
        img {
          width: 36px;
          height: 36px;
        }
      }

      .theme-item {
        line-height: 32px;
        width: 36px;
        height: 36px;
        border-radius: 100%;
        display: inline-block;
        cursor: pointer;
        text-align: center;
        vertical-align: middle;
        pointer-events: all;

        .el-icon-moon {
          color: #f7f7f7;
          line-height: 34px;
        }
        .el-icon-sunny {
          color: #121212;
          line-height: 34px;
        }
      }
    }

    .setting-wrapper:nth-last-child(1) {
      padding-bottom: 20px;
    }
  }

  .setting-zone-wrapper {
    padding: 48px 48px;
    height: 100%;
    max-height: 100%;
    width: 100%;
    background-color: #fff;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;

    .setting-zone-title {
      font-size: 20px;
      font-weight: 600;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
      margin-bottom: 5px;
      min-width: 320px;
      box-sizing: border-box;

      .el-icon-menu {
        cursor: pointer;
      }

      .title-btn {
        font-size: 14px;
        line-height: 28px;
        float: right;
        cursor: pointer;
        user-select: none;
        margin-left: 10px;

        >>>.el-icon-loading {
          font-size: 16px;
        }
      }
    }

    .setting-form-wrapper {
      flex: 1;
      overflow-x: hidden;
      overflow-y: scroll;
      padding: 10px 10px 30px;
    }
  }
}

.night {
  >>>.navigation-wrapper {
    background-color: #121212;
    border-right: 1px solid #555;
  }
  >>>.navigation-title {
    color: #bbb;
  }
  >>>.setting-zone-title {
    color: #bbb;
  }
  >>>.setting-zone-wrapper {
    background-color: #222;
  }
  >>>.el-input__inner {
    background-color: #444;
    border: 1px solid #444 !important;
    color: #aaa;
  }
}

.navigation-inner-wrapper::-webkit-scrollbar {
  width: 0 !important;
}
@media screen and (max-width: 750px) {
  .setting-wrapper {
    overflow-x: hidden;

    >>>.navigation-wrapper {
      .navigation-inner-wrapper {
        padding: 20px 36px 66px 36px;
      }
    }
    >>>.setting-zone-wrapper {
      padding: 0;
      padding-top: constant(safe-area-inset-top) !important;
      padding-top: env(safe-area-inset-top) !important;

      .setting-zone-title {
        padding: 20px 24px 0 24px;
      }
    }
  }
}
</style>
<style>
.navigation-hidden {
  margin-left: -260px;
}
.navigation-in {
  margin-left: 0px;
  transition: margin-left 0.3s;
}
.navigation-out {
  margin-left: -260px;
  transition: margin-left 0.3s;
}
.popper-intro {
  padding: 15px;
}
.book-kind span {
  display: inline-block;
  margin-left: 5px;
  margin-right: 5px;
}
.night-theme .popper-intro {
  background: #121212;
  color: #bbb !important;
  border: none;
}
.night-theme .popper-intro.el-popper[x-placement^="bottom"] .popper__arrow,
.night-theme
  .popper-intro.el-popper[x-placement^="bottom"]
  .popper__arrow::after {
  border-bottom-color: #121212 !important;
}
.night-theme .popper-intro.el-popper[x-placement^="top"] .popper__arrow,
.night-theme .popper-intro.el-popper[x-placement^="top"] .popper__arrow::after {
  border-top-color: #121212 !important;
}
.night-theme .el-popover__title {
  color: #ddd !important;
}
.status-bar-light-bg {
  background-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.2) 0,
    transparent 36px
  ) !important;
}
.status-bar-light-bg-dialog .el-dialog.is-fullscreen {
  background-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.2) 0,
    transparent 36px
  ) !important;
}
@media (hover: hover) {
  .book:hover {
    background: rgba(0, 0, 0, 0.1);
    transition-duration: 0.5s;
  }
  .el-icon-close:hover {
    color: #409eff;
  }
  .el-icon-edit:hover {
    color: #409eff;
  }
}

.mini-interface .el-dialog__body {
  padding: 15px 20px;
}
.book-group-tabs .el-tabs__header {
  margin-bottom: 0px;
}
</style>
