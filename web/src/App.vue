<template>
  <div id="app">
    <keep-alive>
      <router-view></router-view>
    </keep-alive>
    <el-dialog
      title="登录"
      :visible.sync="showLogin"
      :width="dialogWidth"
      :top="dialogTop"
    >
      <el-form :model="loginForm">
        <el-form-item label="用户名">
          <el-input v-model="loginForm.username" autocomplete="on"></el-input>
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            type="password"
            v-model="loginForm.password"
            autocomplete="on"
            show-password
            @keyup.enter.native="login"
          ></el-input>
        </el-form-item>
        <el-form-item label="邀请码(没有则不填)">
          <el-input
            v-model="loginForm.code"
            autocomplete="off"
            @keyup.enter.native="login"
          ></el-input>
        </el-form-item>
        <el-checkbox v-model="remember">记住登录信息</el-checkbox>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button size="medium" @click="cancel">取 消</el-button>
        <el-button size="medium" type="primary" @click="login">确 定</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import Axios from "./plugins/axios";

export default {
  name: "app",
  data() {
    return {
      remember: true,
      loginForm: {
        username: "",
        password: "",
        code: ""
      }
    };
  },
  beforeCreate() {
    this.$store.dispatch("syncFromLocalStorage");

    this.$store.commit("setMiniInterface", window.innerWidth <= 750);

    document.documentElement.style.setProperty(
      "--vh",
      `${window.innerHeight * 0.01}px`
    );

    window.onresize = () => {
      document.documentElement.style.setProperty(
        "--vh",
        `${window.innerHeight * 0.01}px`
      );
      this.$store.commit("setMiniInterface", window.innerWidth <= 750);
      this.$store.commit("setWindowSize", {
        width: window.innerWidth,
        height: window.innerHeight
      });
      this.$store.commit("setTouchable", "ontouchstart" in document);
    };

    const api = window.getQueryString("api");
    if (api) {
      this.$store.commit("setApi", api);
    }

    window.webAppDistance =
      window.navigator.userAgent.indexOf("iPhone") >= 0 &&
      window.navigator.standalone
        ? (window.devicePixelRatio - 1 || 1) * 20
        : 0;
    document.documentElement.style.setProperty(
      "--status-bar-height",
      `${window.webAppDistance}px`
    );

    try {
      const docStyle = getComputedStyle(document.documentElement);
      this.$store.commit("setSafeArea", {
        top: docStyle.getPropertyValue("--sat") | 0,
        bottom: docStyle.getPropertyValue("--sab") | 0,
        left: docStyle.getPropertyValue("--sal") | 0,
        right: docStyle.getPropertyValue("--sar") | 0
      });
    } catch (error) {
      //
    }
  },
  created() {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        this.autoSetTheme(this.autoTheme);
      });
    this.autoSetTheme(this.autoTheme);

    this.getUserInfo();
  },
  beforeMount() {
    this.setTheme(this.isNight);
  },
  mounted() {
    document.documentElement.style.setProperty(
      "--vh",
      `${window.innerHeight * 0.01}px`
    );
    window.reader = this;
  },
  computed: {
    isNight() {
      return this.$store.getters.isNight;
    },
    autoTheme() {
      return this.$store.state.config.autoTheme;
    },
    dialogWidth() {
      return this.$store.state.miniInterface ? "85%" : "450px";
    },
    dialogTop() {
      return (
        Math.max(
          (this.$store.state.windowSize.height - 390 - 70 - 54) / 2,
          50
        ) + "px"
      );
    },
    showLogin: {
      get() {
        return this.$store.state.showLogin;
      },
      set(value) {
        this.$store.commit("setShowLogin", value);
      }
    },
    connected() {
      return this.$store.state.connected;
    }
  },
  watch: {
    isNight(val) {
      this.setTheme(val);
    },
    autoTheme(val) {
      this.autoSetTheme(val);
    },
    connected(val) {
      if (val) {
        // 连接后端成功，加载自定义样式
        window.customCSSLoad ||
          window.loadLink(this.$store.getters.customCSSUrl, () => {
            window.customCSSLoad = true;
          });
      }
    }
  },
  methods: {
    autoSetTheme(autoTheme) {
      if (autoTheme) {
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
          // 是暗色模式
          this.$store.commit("setNightTheme", true);
        } else {
          // 非暗色模式
          this.$store.commit("setNightTheme", false);
        }
      }
    },
    setTheme(isNight) {
      if (isNight) {
        document.body.className =
          (document.body.className || "").replace("night-theme", "") +
          " night-theme";
      } else {
        document.body.className = (document.body.className || "").replace(
          "night-theme",
          ""
        );
      }
    },
    cancel() {
      this.showLogin = false;
      this.loginForm = {
        username: "",
        password: "",
        code: ""
      };
    },
    async login() {
      const res = await Axios.post("/login", this.loginForm);
      if (res.data.isSuccess) {
        this.$store.commit("setShowLogin", false);
        this.$nextTick(() => {
          this.$store.commit("setLoginAuth", true);
        });
        if (this.remember && res.data.data && res.data.data.accessToken) {
          this.$store.commit("setToken", res.data.data.accessToken);
        }
        this.getUserInfo();
      }
    },
    getUserInfo() {
      Axios.get(this.api + "/getUserInfo").then(
        res => {
          this.$store.commit("setConnected", true);
          if (res.data.isSuccess) {
            this.$store.commit("setIsSecureMode", res.data.data.secure);
            if (res.data.data.secure && res.data.data.secureKey) {
              this.$store.commit("setShowManagerMode", true);
            }
            if (res.data.data.userInfo) {
              this.$store.commit("setUserInfo", res.data.data.userInfo);
            }
          }
        },
        error => {
          this.$message.error(
            "加载用户信息失败 " + (error && error.toString())
          );
        }
      );
    }
  }
};
</script>

<style>
#app {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
  margin: 0;
  height: 100%;
  height: calc(100% + var(--status-bar-height, 0px));
  position: relative;
}

@font-face {
  font-family: "reader-st";
  src: local("Songti SC"), local("Noto Serif CJK SC"),
    local("Source Han Serif SC"), local("Source Han Serif CN"), local("STSong"),
    local("宋体"), local("明体"), local("明朝"), local("Songti"),
    local("Songti TC"), /*iOS6+iBooks3*/ local("Song S"), local("Song T"),
    local("STBShusong"), local("TBMincho"), local("HYMyeongJo"),
    /*Kindle Paperwihite*/ local("DK-SONGTI");
}

@font-face {
  font-family: "reader-fs";
  src: local("STFangsong"), local("FangSong"), local("FangSong_GB2312"),
    local("amasis30"), local("仿宋"), local("仿宋_GB2312"), local("Yuanti"),
    local("Yuanti SC"), local("Yuanti TC"),
    /*iOS6+iBooks3*/ local("DK-FANGSONG");
}

@font-face {
  font-family: "reader-kt";
  src: local("Kaiti SC"), local("STKaiti"), local("Caecilia"), local("楷体"),
    local("楷体_GB2312"), local("Kaiti"), local("Kaiti SC"), local("Kaiti TC"),
    /*iOS6+iBooks3*/ local("MKai PRC"), local("MKaiGB18030C-Medium"),
    local("MKaiGB18030C-Bold"), /*Kindle Paperwihite*/ local("DK-KAITI");
}

@font-face {
  font-family: "reader-ht";
  src: local("Noto Sans CJK SC"), local("Source Han Sans SC"),
    local("Source Han Sans CN"), local("Microsoft YaHei"), local("PingFang SC"),
    local("Hiragino Sans GB"), local("黑体"), local("微软雅黑"), local("Heiti"),
    local("Heiti SC"), local("Heiti TC"), /*iOS6+iBooks3*/ local("MYing Hei S"),
    local("MYing Hei T"), local("TBGothic"),
    /*Kindle Paperwihite*/ local("DK-HEITI");
}
*::-webkit-scrollbar {
  display: none;
  width: 0 !important;
  height: 0 !important;
}
*:focus {
  outline: none !important;
}
</style>
<style lang="stylus">
.popper-component {
  top: 0 !important;
}
@media screen and (max-width: 750px) {
  .popper-component {
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    box-sizing: border-box;
    margin: 0 !important;
    overflow-x: hidden;
  }
}
.night-theme {
  .el-message-box {
    background: #212121;
    border: 1px solid #212121;
    .el-message-box__title {
      color: #888;
    }
    .el-message-box__content {
      color: #777;
    }
  }
  .el-button--default {
    background: #888;
    color: #ddd;
    border: 1px solid #888;
  }
  .el-button:focus, .el-button:hover {
      color: #eee;
      border-color: #bbb;
      background-color: #bbb;
  }
  .el-button.is-disabled, .el-button.is-disabled:focus, .el-button.is-disabled:hover {
      color: #C0C4CC;
      background-color: #333;
      border-color: #333;
  }
  .el-button--primary {
    background: #185798;
    border: 1px solid #185798;
  }
  .el-button--primary:focus, .el-button--primary:hover {
      background: #2b67bb;
      border-color: #2b67bb;
      color: #FFF;
  }
  .el-checkbox__inner {
    background: #bbb;
  }
  .el-input__inner {
    background-color: #444;
    border: 1px solid #444 !important;
    color: #ddd;
  }
  .el-select-dropdown {
    background-color: #333;
    border: 1px solid #333 !important;
  }
  .el-select-dropdown__item {
    color: #ddd;
  }
  .el-select-dropdown__item.hover, .el-select-dropdown__item:hover {
    background-color: #444;
  }
  .el-popper[x-placement^="bottom"] .popper__arrow, .el-popper[x-placement^="bottom"] .popper__arrow::after {
    border-bottom-color: #333 !important;
  }
  .el-popper[x-placement^="top"] .popper__arrow, .el-popper[x-placement^="top"] .popper__arrow::after {
    border-top-color: #333 !important;
  }
  .el-dialog {
    background-color: #222;
  }
  .el-dialog__title {
    color: #bbb;
  }
  .el-pagination .btn-next, .el-pagination .btn-prev {
    background: center center no-repeat #444;
    color: #ddd;
  }
  .el-pager li {
    background: #444;
    color: #ddd;
  }
  .el-pager li.btn-quicknext, .el-pager li.btn-quickprev {
    color: #ddd;
  }
}
.el-popover:focus, .el-popover:focus:active, .el-popover__reference:focus:hover, .el-popover__reference:focus:not(.focusing) {
  outline: none;
}
.el-message-box {
  max-width: 85vw;
}
.popper-component.el-popover {
  border: none;
  box-shadow: none;
}
</style>
